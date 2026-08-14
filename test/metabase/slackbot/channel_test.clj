(ns metabase.slackbot.channel-test
  (:require
   [clojure.string :as str]
   [clojure.test :refer :all]
   [metabase.metabot.persistence :as metabot.persistence]
   [metabase.slackbot.channel :as slackbot.channel]
   [metabase.slackbot.client :as slackbot.client]
   [metabase.slackbot.test-util :as tu]
   [metabase.test :as mt]))

(def ^:private table-viz-blocks
  "The blocks `collect-viz-blocks` returns for a table visualization: a title section
   followed by the table itself."
  [{:type "section" :text {:type "mrkdwn" :text "*Query results*"}}
   {:type "table" :rows [] :column_settings []}])

(def ^:private feedback-block
  {:type "context_actions" :block_id "metabot_feedback" :elements []})

(defn- fake-slack-post
  "Validate `blocks` the way Slack does, returning its `invalid_blocks` error for the first
   oversized section block and a successful response otherwise."
  [{:keys [blocks]}]
  (if-let [idx (tu/oversized-section-index blocks)]
    (tu/invalid-blocks-response idx)
    {:ok true :ts "1700000000.000002"}))

(defn- send-channel-response!
  "Drive `send-channel-response` with stubbed collaborators, no DB, LLM or Slack required.

   `text-chunks` are handed to `on-text` one at a time, mimicking the text parts the agent
   loop emits across a multi-round tool-calling turn. `post-fn` receives each recorded post
   and returns the Slack response to hand back.

   Returns `{:posts [...] :statuses [...]}`."
  [{:keys [text-chunks viz-blocks post-fn]
    :or   {text-chunks [] viz-blocks []}}]
  (let [posts    (atom [])
        statuses (atom [])]
    (mt/with-dynamic-fn-redefs [slackbot.client/set-status (fn [_client opts]
                                                             (swap! statuses conj (:loading-messages opts))
                                                             {:ok true})
                                slackbot.client/post-thread-reply (fn [_client _ctx text & {:keys [blocks]}]
                                                                    (let [call     {:text text :blocks blocks}
                                                                          response (post-fn call)]
                                                                      (swap! posts conj (assoc call :response response))
                                                                      response))
                                metabot.persistence/set-response-slack-msg-id! (constantly nil)]
      (slackbot.channel/send-channel-response
       {}
       {:ts "1700000000.000001"}
       nil
       {:channel-id      "C123"
        :message-ctx     {:channel "C123" :thread_ts "1700000000.000001"}
        :channel         "C123"
        :thread-ts       "1700000000.000001"
        :auth-info       {:team_id "T123"}
        :thread          {:messages []}
        :bot-user-id     "U999"
        :prompt          "hello"
        :conversation-id "conversation-id"}
       {:tool-name->friendly        {}
        :make-streaming-ai-request  (fn [_conversation-id _prompt _thread _bot-user-id _channel-id _extra-history
                                         {:keys [on-text]}]
                                      (run! on-text text-chunks)
                                      {:msg-id 42 :external-id "message-external-id"})
        :collect-viz-blocks         (constantly {:blocks viz-blocks :errors []})
        :feedback-blocks            (constantly [feedback-block])
        :post-viz-error!            (constantly nil)
        :make-viz-prefetch-callback (constantly (fn [& _]))
        :cancel-prefetched-viz!     (constantly nil)}))
    {:posts @posts :statuses @statuses}))

(defn- section-texts
  "The `text.text` of every `section` block, in order."
  [blocks]
  (->> blocks
       (filter #(= "section" (:type %)))
       (map #(get-in % [:text :text]))))

(defn- text-blocks
  "The section texts `final-text-blocks` builds for `text`."
  [text]
  (mapv #(get-in % [:text :text]) (#'slackbot.channel/final-text-blocks text)))

(defn- squish
  "Drop all whitespace so text can be compared across paragraph-boundary splits."
  [s]
  (str/replace s #"\s+" ""))

(deftest channel-response-passes-slack-metadata-for-deep-linking-test
  (let [request-opts  (atom nil)
        backfill-args (atom nil)]
    (mt/with-dynamic-fn-redefs [slackbot.client/set-status (constantly {:ok true})
                                slackbot.client/post-thread-reply (constantly {:ok true :ts "1700000000.000002"})
                                metabot.persistence/set-response-slack-msg-id!
                                (fn [msg-id slack-msg-id]
                                  (reset! backfill-args {:msg-id msg-id :slack-msg-id slack-msg-id}))]
      (slackbot.channel/send-channel-response
       {}
       {:ts "1700000000.000001"}
       nil
       {:channel-id      "C123"
        :message-ctx     {:channel "C123" :thread_ts "1700000000.000001"}
        :channel         "C123"
        :thread-ts       "1700000000.000001"
        :auth-info       {:team_id "T123"}
        :thread          {:messages []}
        :bot-user-id     "U999"
        :prompt          "hello"
        :conversation-id "conversation-id"}
       {:tool-name->friendly        {}
        :make-streaming-ai-request  (fn [& args]
                                      (reset! request-opts (last args))
                                      {:msg-id      42
                                       :external-id "message-external-id"})
        :collect-viz-blocks         (constantly {:blocks [] :errors []})
        :feedback-blocks            (constantly [])
        :post-viz-error!            (constantly nil)
        :make-viz-prefetch-callback (constantly (fn [& _]))
        :cancel-prefetched-viz!     (constantly nil)}))
    (is (= {:team-id          "T123"
            :thread-ts        "1700000000.000001"
            :req-slack-msg-id "1700000000.000001"}
           (select-keys @request-opts [:team-id :thread-ts :req-slack-msg-id])))
    (is (= {:msg-id 42 :slack-msg-id "1700000000.000002"}
           @backfill-args))))

(deftest channel-response-splits-oversized-text-test
  (testing "a long answer is split so Slack accepts every section block (BOT-1606)"
    ;; Five ~690-character paragraphs, mirroring the narration the agent loop emits before
    ;; each tool call plus the final answer. `on-text` concatenates all of them, so the
    ;; answer is 3450 characters -- over Slack's 3000 character section limit.
    (let [chunks          (mapv #(str (apply str (repeat 690 %)) "\n\n") ["a" "b" "c" "d" "e"])
          answer          (str/trim (apply str chunks))
          {:keys [posts]} (send-channel-response! {:text-chunks chunks
                                                   :viz-blocks  table-viz-blocks
                                                   :post-fn     fake-slack-post})
          {:keys [blocks]} (first posts)]
      (is (= 1 (count posts))
          "the response is delivered in a single post")
      (is (:ok (:response (first posts)))
          "Slack accepts the post instead of rejecting it with invalid_blocks")
      (is (every? #(<= (count %) tu/slack-section-text-limit) (section-texts blocks))
          "no section block exceeds Slack's 3000 character limit")
      (is (= (squish answer)
             (squish (apply str (butlast (section-texts blocks)))))
          "splitting the answer preserves all of its text")
      (is (= ["table" "context_actions"]
             (mapv :type (drop-while #(= "section" (:type %)) blocks)))
          "the viz and feedback blocks still follow the answer"))))

(deftest channel-response-falls-back-when-slack-rejects-blocks-test
  (testing "when Slack rejects the blocks the user is told, instead of being left in silence (BOT-1606)"
    (let [first-post?          (atom true)
          {:keys [posts statuses]}
          (send-channel-response! {:text-chunks ["Here are your results."]
                                   :viz-blocks  table-viz-blocks
                                   :post-fn     (fn [_call]
                                                  (if (first (reset-vals! first-post? false))
                                                    (tu/invalid-blocks-response 1)
                                                    {:ok true :ts "1700000000.000003"}))})
          fallback             (second posts)]
      (is (= 2 (count posts))
          "a fallback message is posted after Slack rejects the response")
      (is (str/includes? (:text fallback) "could not render")
          "the fallback explains that the response could not be rendered")
      (is (nil? (:blocks fallback))
          "the fallback is plain text, so it cannot be rejected for the same reason")
      (is (= [""] (last statuses))
          "the thread status is cleared so the spinner does not linger"))))

(deftest ^:parallel final-text-blocks-test
  (testing "blank text produces no blocks"
    (is (= [] (text-blocks "")))
    (is (= [] (text-blocks "   "))))
  (testing "text within Slack's limit is left alone"
    (is (= ["Here is your answer"] (text-blocks "Here is your answer"))))
  (testing "long text splits on paragraph boundaries, keeping every paragraph intact"
    (let [paragraphs (mapv #(apply str (repeat 1000 %)) ["a" "b" "c" "d" "e"])
          blocks     (text-blocks (str/join "\n\n" paragraphs))]
      (is (< 1 (count blocks)))
      (is (every? #(<= (count %) tu/slack-section-text-limit) blocks))
      (is (= paragraphs (mapcat #(str/split % #"\n\n") blocks))
          "no paragraph is cut in half")))
  (testing "a single run longer than the limit is hard cut rather than dropped"
    (let [blocks (text-blocks (apply str (repeat 7000 "x")))]
      (is (= [3000 3000 1000] (mapv count blocks)))))
  (testing "text past the block cap is truncated with a notice instead of silently dropped"
    (let [blocks (text-blocks (str/join "\n\n" (repeat 25 (apply str (repeat 2900 "y")))))]
      (is (= 20 (count blocks)))
      (is (every? #(<= (count %) tu/slack-section-text-limit) blocks))
      (is (str/ends-with? (last blocks) "_Response truncated._")))))
