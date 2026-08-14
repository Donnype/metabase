(ns metabase.slackbot.channel
  "Visible Slack channel reply/update flow for metabot."
  (:require
   [clojure.string :as str]
   [metabase.metabot.persistence :as metabot.persistence]
   [metabase.slackbot.client :as slackbot.client]
   [metabase.util.log :as log]))

(set! *warn-on-reflection* true)

(def ^:private channel-response-style-suffix
  (str "\n\n"
       "For this Slack channel response: the user already saw tool progress updates. "
       "Do not narrate the steps you took, do not recap tool calls, and do not include preambles like "
       "\"I'll...\", \"Let me...\", or \"I found...\". Give a brief final response in "
       "1-2 sentences before any table or chart."))

(defn- channel-request-prompt
  "Append channel-specific response style guidance without changing the stored user prompt."
  [prompt]
  (str prompt channel-response-style-suffix))

(def ^:private section-text-limit
  "Slack rejects a `section` block whose `text.text` exceeds 3000 characters with `invalid_blocks`."
  3000)

(def ^:private max-text-blocks
  "Maximum number of `section` blocks to spend on the answer text. Slack caps a message at
   50 blocks total; the rest of the budget is left for visualizations and the feedback
   buttons."
  20)

(defn- text-chunks
  "Split `text` into chunks of at most [[section-text-limit]] characters, preferring
   paragraph then line boundaries so markdown structure survives. A single run longer than
   the limit is hard cut."
  [text]
  (loop [remaining text
         chunks    []]
    (if (<= (count remaining) section-text-limit)
      (conj chunks remaining)
      (let [window    (subs remaining 0 section-text-limit)
            ;; Prefer the last paragraph break, then the last line break, then a hard cut.
            break-idx (or (str/last-index-of window "\n\n")
                          (str/last-index-of window "\n")
                          section-text-limit)
            ;; A break at index 0 would make no progress; hard cut instead.
            break-idx (if (zero? break-idx) section-text-limit break-idx)]
        (recur (subs remaining break-idx)
               (conj chunks (subs remaining 0 break-idx)))))))

(defn- with-truncation-notice
  "Trim `chunks` to [[max-text-blocks]], marking the last kept chunk so the dropped tail is
   visible to the reader rather than silently lost."
  [chunks]
  (let [kept (vec (take max-text-blocks chunks))]
    (if (<= (count chunks) max-text-blocks)
      kept
      (let [notice "\n\n_Response truncated._"
            room   (- section-text-limit (count notice))
            tail   (peek kept)]
        (conj (pop kept)
              (str (str/trimr (cond-> tail
                                (> (count tail) room) (subs 0 room)))
                   notice))))))

(defn- final-text-blocks
  "Build the leading text block(s) for a finalized non-streaming Slack message.
   Long answers are split across several `section` blocks so Slack accepts the message."
  [text]
  (if (str/blank? text)
    []
    (into []
          (comp (remove str/blank?)
                (map (fn [chunk]
                       {:type "section"
                        :text {:type "mrkdwn"
                               :text (str/trim chunk)}})))
          (with-truncation-notice (text-chunks text)))))

(defn- make-channel-callbacks
  "Create callback functions for channel replies.
   Uses the Slack assistant setStatus API for progress indication.
   Text is accumulated and sent once in the final message post."
  [client {:keys [channel thread-ts tool-name->friendly]}]
  (let [current-text (atom "")]
    (letfn [(set-status! [status]
              (try
                (slackbot.client/set-status client {:status "is doing science..."
                                                    :channel-id channel
                                                    :thread-ts  thread-ts
                                                    :loading-messages [(or status "")]})
                (catch Exception e
                  (log/warnf "[slackbot] set-status failed (channel=%s thread-ts=%s): %s" channel thread-ts (ex-message e)))))]
      ;; Every text part from every round of the agent loop lands here, so the accumulated
      ;; answer routinely exceeds Slack's section limit -- see `final-text-blocks`.
      {:on-text       (bound-fn* (fn [text]
                                   (when (seq text)
                                     (swap! current-text str text))))
       :on-tool-start (fn [{:keys [tool-name]}]
                        (set-status! (str (tool-name->friendly tool-name "Thinking") "...")))
       :set-status!   set-status!
       :current-text  current-text})))

(defn send-channel-response
  "Send a visible threaded reply for non-DM Slack conversations.
   Accumulates AI text during streaming and posts the final response as a single message."
  [client event extra-history {:keys [channel-id message-ctx channel thread-ts auth-info thread bot-user-id prompt conversation-id]}
   {:keys [tool-name->friendly
           make-streaming-ai-request collect-viz-blocks feedback-blocks post-viz-error!
           make-viz-prefetch-callback cancel-prefetched-viz!]}]
  (let [{:keys [on-text on-tool-start set-status! current-text]}
        (make-channel-callbacks client {:channel              channel
                                        :thread-ts            thread-ts
                                        :tool-name->friendly  tool-name->friendly})
        prefetched-viz (atom {})
        on-data        (make-viz-prefetch-callback prefetched-viz)]
    (set-status! "Thinking...")
    (try
      (let [{message-external-id :external-id assistant-msg-id :msg-id}
            (make-streaming-ai-request
             conversation-id
             prompt
             thread
             bot-user-id
             channel-id
             extra-history
             {:on-text              on-text
              :on-tool-start        on-tool-start
              :on-tool-end          nil
              :on-data              on-data
              :team-id              (:team_id auth-info)
              :thread-ts            thread-ts
              :req-slack-msg-id     (:ts event)
              :get-res-slack-msg-id nil
              :request-prompt       (channel-request-prompt prompt)})]
        (when (seq @prefetched-viz)
          (set-status! "Rendering results..."))
        (let [{:keys [blocks errors]} (collect-viz-blocks @prefetched-viz)
              answer-text             (str/trim @current-text)
              final-text              (if (or (seq answer-text) (seq blocks))
                                        answer-text
                                        "I wasn't able to generate a response. Please try again.")
              final-blocks            (into (into (final-text-blocks final-text) blocks)
                                            (feedback-blocks conversation-id message-external-id))
              res                     (slackbot.client/post-thread-reply client {:channel channel :thread_ts thread-ts}
                                                                         final-text :blocks final-blocks)]
          (when-let [res-ts (:ts res)]
            (metabot.persistence/set-response-slack-msg-id! assistant-msg-id res-ts))
          (when-not (:ok res)
            (log/errorf "[slackbot] channel post-message failed: %s (block_count=%d block_types=%s response_messages=%s)"
                        (:error res)
                        (count final-blocks)
                        (pr-str (mapv :type final-blocks))
                        (pr-str (get-in res [:response_metadata :messages])))
            ;; Slack returns `{:ok false}` rather than throwing, so without this the thread
            ;; just goes silent. Fall back to plain text, which can't be rejected the same way.
            (set-status! nil)
            (let [fallback-res (slackbot.client/post-thread-reply
                                client message-ctx
                                "I generated a response, but Slack could not render it. Please try again.")]
              (when-not (:ok fallback-res)
                (log/errorf "[slackbot] channel fallback post-message failed: %s" (:error fallback-res)))))
          (doseq [e errors]
            (post-viz-error! client channel thread-ts e))))
      (catch Exception e
        (cancel-prefetched-viz! prefetched-viz)
        (log/errorf "[slackbot] Error in channel response: %s" (ex-message e))
        (set-status! nil)
        (let [res (slackbot.client/post-thread-reply client message-ctx
                                                     "Something went wrong. Please try again.")]
          (when-not (:ok res)
            (log/errorf "[slackbot] channel error post-message failed: %s" (:error res))))))))
