(ns metabase.llm.api.provider
  "Admin endpoints for managing LLM provider connections at `/api/llm`.

  Connections are stored in the `llm-providers` setting, but the setting is never edited directly from the client:
  these endpoints present it as a collection of rows so secrets can be masked on the way out and preserved on the
  way back in, and so a connection is only saved once its credentials have been shown to work."
  (:require
   [clojure.core.cache :as cache]
   [clojure.core.cache.wrapped :as cache.wrapped]
   [clojure.string :as str]
   [metabase.api.common :as api]
   [metabase.api.macros :as api.macros]
   [metabase.llm.health :as llm.health]
   [metabase.llm.provider :as llm.provider]
   [metabase.metabot.self :as metabot.self]
   [metabase.metabot.settings :as metabot.settings]
   [metabase.permissions.core :as perms]
   [metabase.premium-features.core :refer [defenterprise]]
   [metabase.settings.core :as setting]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.log :as log]))

(set! *warn-on-reflection* true)

;;; --------------------------------------------------- Schemas ----------------------------------------------------

(def ^:private field-response-schema
  [:map
   [:key :string]
   [:label :string]
   [:type [:enum "text" "password" "select" "segmented" "file"]]
   [:required :boolean]
   [:advanced :boolean]
   [:placeholder {:optional true} [:maybe :string]]
   [:default {:optional true} [:maybe :string]]
   [:help {:optional true} [:maybe :string]]
   [:docs_url {:optional true} [:maybe :string]]
   [:prefix {:optional true} [:maybe :string]]
   [:options {:optional true} [:maybe [:sequential [:map [:value :string] [:label :string]]]]]
   ;; the field is only shown, and only sent, while the named field holds this value
   [:show_when {:optional true} [:maybe [:map [:field :string] [:value :string]]]]])

(def ^:private provider-type-response-schema
  [:map
   [:type :string]
   [:label :string]
   [:managed :boolean]
   [:singleton :boolean]
   [:available :boolean]
   [:default_model [:maybe :string]]
   [:fields [:sequential field-response-schema]]])

(def ^:private connection-failure-response-schema
  [:map
   [:message :string]
   ;; Whether retrying is pointless until the connection is changed — a rejected key rather than an outage.
   [:fatal :boolean]])

(def ^:private connection-response-schema
  [:map
   [:key :string]
   [:type :string]
   [:name :string]
   [:source [:enum "db" "env"]]
   [:usable :boolean]
   [:reorderable :boolean]
   [:error [:maybe connection-failure-response-schema]]
   [:env_vars [:sequential :string]]
   [:config [:map-of :keyword [:maybe :string]]]])

(def ^:private active-model-response-schema
  [:map
   [:model_ref [:maybe :string]]
   [:model [:maybe :string]]
   [:connection_key [:maybe :string]]
   [:connection_name [:maybe :string]]
   [:selected_model_ref [:maybe :string]]
   [:is_fallback :boolean]])

(def ^:private llm-model-response-schema
  [:map
   [:id :string]
   [:display_name :string]])

(def ^:private models-response-schema
  [:sequential
   [:map
    [:key :string]
    [:name :string]
    [:type :string]
    [:models [:sequential llm-model-response-schema]]
    [:error {:optional true} [:maybe :string]]]])

(def ^:private config-schema
  [:map-of :keyword [:maybe :string]])

(def ^:private connection-key-schema
  [:string {:api/regex #"[a-z0-9][a-z0-9-]*"}])

;;; -------------------------------------------------- Responses ---------------------------------------------------

(defn- option-response
  [{:keys [value label]}]
  {:value value :label (str label)})

(defn- field-response
  [{:keys [key label type required? advanced? placeholder default help docs-url prefix options show-when]}]
  (cond-> {:key      (name key)
           :label    (str label)
           :type     (name type)
           :required (boolean required?)
           :advanced (boolean advanced?)}
    placeholder (assoc :placeholder (str placeholder))
    default     (assoc :default default)
    help        (assoc :help (str help))
    docs-url    (assoc :docs_url docs-url)
    prefix      (assoc :prefix prefix)
    options     (assoc :options (mapv option-response options))
    show-when   (assoc :show_when {:field (name (:field show-when)) :value (:value show-when)})))

(defn- provider-type-response
  [{:keys [type label managed? singleton? default-model fields]}]
  {:type          type
   :label         (str label)
   :managed       (boolean managed?)
   :singleton     (boolean singleton?)
   :available     (llm.provider/type-available? type)
   :default_model default-model
   :fields        (mapv field-response fields)})

(defn- connection-reorderable?
  "Whether this connection's position in the fallback order can be changed. Only connections stored
  in `llm-providers` can move: ones synthesized from the single-provider environment variables are appended to
  whatever is stored, and the whole list is read-only when `llm-providers` itself comes from the environment."
  [conn-key]
  (and (nil? (setting/env-var-value :llm-providers))
       (boolean (some #(= conn-key (:key %)) (llm.provider/stored-connections)))))

(defn- connection-failure-response
  [conn-key]
  (when-let [{:keys [message fatal?]} (llm.health/failure conn-key)]
    {:message message :fatal fatal?}))

(defn- connection-response
  [{conn-key :key conn-name :name :keys [type source config env-vars] :as conn}]
  {:key         conn-key
   :type        type
   :name        conn-name
   :source      (name (or source :db))
   :usable      (llm.provider/config-complete? type config)
   :reorderable (connection-reorderable? conn-key)
   :error       (connection-failure-response conn-key)
   :env_vars    (vec env-vars)
   :config      (or (:config (llm.provider/redact conn)) {})})

;;; ------------------------------------------------ Model listing -------------------------------------------------

(defn- provider-client-error?
  "Whether a provider api-error is a client-side 4xx we should surface rather than treat as an outage. Covers
  rejected or missing credentials (401/403) and a request the provider refused outright."
  [error]
  (let [{:keys [api-error status status-code]} (ex-data error)
        status (or status status-code)]
    (and api-error (number? status) (<= 400 status 499))))

(defn- list-connection-models*
  "List `conn`'s models. `config-override` stands in for the stored credentials when validating a connection that has
  not been saved yet. Returns `{:models [...]}` or `{:models [] :error msg}` for a credential-level failure.

  Types whose catalog is fixed (the managed provider, which serves one model through the proxy) are answered from
  the registry — there is nothing to fetch, and calling out would fail on instances that cannot reach the proxy.

  Types that name their model in `:config` (Azure, whose deployments its listing endpoint does not return) still
  make the call, because it is what verifies the credentials, but the model they serve comes from the connection
  rather than the empty list that comes back."
  [{:keys [type config]} config-override model]
  (if-let [models (llm.provider/fixed-models type)]
    {:models (vec models)}
    (let [config           (llm.provider/with-field-defaults type (or config-override config))
          configured-model (llm.provider/connection-model type config)
          model            (or model configured-model)]
      (try
        (let [listed (:models (metabot.self/list-models type (cond-> {:credentials config}
                                                               model (assoc :model model))))]
          {:models (if configured-model
                     [{:id configured-model :display_name (last (str/split configured-model #"/"))}]
                     (vec listed))})
        (catch clojure.lang.ExceptionInfo e
          (if (provider-client-error? e)
            {:models [] :error (.getMessage e)}
            (throw e)))))))

(def ^:private models-cache-ttl-ms
  "How long a connection's model list is reused. Long enough that an admin page load does not fan out to every
  provider on every render, short enough that a model a provider has just granted shows up without a restart."
  60000)

(defonce ^:private models-cache
  (atom (cache/ttl-cache-factory {} :ttl models-cache-ttl-ms)))

(defn- models-cache-key
  "What a cached model list is filed under. The config is reduced to a hash rather than held as-is: it carries the
  connection's API key, and a cache entry outlives the connection that produced it. Hashing it also retires the
  entry the moment a credential is rotated, instead of serving the old list until the TTL runs out."
  [{conn-key :key :keys [type config]}]
  [conn-key type (hash config)])

(defn- record-listing-health!
  "Report a model listing to [[metabase.llm.health]] so what it found outlives the response — the provider list
  shows the failure, and the fallback skips the connection until it works again. Returns `result`.

  Called on the way into the cache rather than on every read, so an error being served from the cache does not keep
  pushing back the moment a transient failure expires. Types whose catalog is fixed are answered from the registry
  without a request, so they prove nothing about the connection either way and are left out of the record."
  [{conn-key :key :keys [type]} {:keys [error transient?] :as result}]
  (when-not (llm.provider/fixed-models type)
    (if error
      (llm.health/record-failure! conn-key error (not transient?))
      (llm.health/record-success! conn-key)))
  result)

(defn- connection-models-response
  "List `conn`'s models for the client, reporting to [[metabase.llm.health]] whatever the listing found."
  [{conn-key :key conn-name :name :keys [type] :as conn}]
  (merge {:key conn-key :name conn-name :type type}
         (dissoc
          (try
            (cache.wrapped/lookup-or-miss models-cache (models-cache-key conn)
                                          (fn [_] (record-listing-health! conn (list-connection-models* conn nil nil))))
            (catch Exception e
              (log/warn e "Failed to list models for LLM provider connection" {:connection conn-key})
              ;; Not a rejection from the provider — a request that never got an answer, which a later one still
              ;; might, so it is not cached and not held against the connection permanently.
              (record-listing-health! conn {:models [] :error (.getMessage e) :transient? true})))
          :transient?)))

;;; -------------------------------------------------- Validation --------------------------------------------------

(defn- check-not-env-connection!
  "Throw a 400 when `conn` is configured by environment variables. Writes to env-shadowed settings persist to the
  app DB but the env var wins on every read, so they silently do nothing."
  [{:keys [key source]}]
  (when (= :env (keyword source))
    (throw (ex-info (tru "The {0} connection is configured by environment variables and cannot be changed here."
                         (pr-str key))
                    {:status-code 400 :connection-key key}))))

(defn- check-connections-not-env-managed!
  []
  (when (some? (setting/env-var-value :llm-providers))
    (throw (ex-info (tru "LLM provider connections are set by the {0} environment variable and cannot be changed via the API."
                         (setting/env-var-name :llm-providers))
                    {:status-code 400}))))

(defn- verify-credentials!
  "Confirm `config` can actually reach `conn`'s provider before anything is persisted, by listing its models.
  Throws a 400 carrying the provider's own message when the credentials are rejected."
  [conn config model]
  (when-not (llm.provider/managed-type? (:type conn))
    (let [{:keys [error]} (list-connection-models* conn config model)]
      (when error
        (throw (ex-info error {:status-code 400 :api-error true}))))))

(defn- fallback-model-ref
  "A model reference to fall back to once the connection Metabot was pointed at is gone: the first remaining
  connection that names a model, or nil to leave Metabot unconfigured. Unlike the runtime fallback this ignores
  which connections are currently failing — a recorded failure is a reason to route around a connection, not to
  refuse to select it."
  []
  (llm.provider/first-model-ref))

(defenterprise cancel-managed-ai-subscription!
  "Cancel the Metabase Cloud add-on that backs the Metabase-managed provider, called when its connection is
  removed. OSS instances have no subscription to cancel."
  metabase-enterprise.metabot.provider
  []
  nil)

(defn- metabot-has-a-usable-model?
  "Whether `llm-metabot-provider` currently names a connection that can serve requests. Callers must read this
  *before* saving a new connection: the setting's default names the `anthropic` connection, which a freshly saved
  Anthropic connection would satisfy retroactively."
  []
  (llm.provider/connection-usable?
   (llm.provider/model-ref->connection-key (metabot.settings/llm-metabot-provider))))

(defn- select-model-for-new-connection!
  "Point Metabot at a freshly created connection when it had nothing usable to run on, so connecting the first
  provider leaves the instance working rather than connected-but-with-no-model-selected. An existing selection that
  still resolves is left alone — adding a second provider must not silently switch Metabot over to it."
  [{conn-key :key :as conn} requested-model]
  (when-let [model-ref (if (not-empty requested-model)
                         (str conn-key "/" requested-model)
                         (llm.provider/connection-model-ref conn))]
    (setting/set! :llm-metabot-provider model-ref)))

(defn- follow-edited-connection-model!
  "Keep `llm-metabot-provider` on the model an edited connection actually serves.

  A model reference stores the model as a string rather than as a live lookup, so for a type whose model comes from
  its own config — Azure, whose reference bakes in `{family}/{deployment-name}` — editing the connection can leave
  the selection naming a deployment that no longer exists. The connection still reports usable, and the next
  request fails at the provider. Types whose model is chosen independently of their credentials are left alone."
  [{conn-key :key :keys [type config] :as conn}]
  (when (and (llm.provider/connection-model type (llm.provider/with-field-defaults type config))
             (= conn-key (llm.provider/model-ref->connection-key (metabot.settings/llm-metabot-provider))))
    (let [model-ref (llm.provider/connection-model-ref conn)]
      (when-not (= model-ref (metabot.settings/llm-metabot-provider))
        (setting/set! :llm-metabot-provider model-ref)))))

;;; -------------------------------------------------- Endpoints ---------------------------------------------------

(defn- offer-managed-first
  "Lead with the Metabase-managed provider on instances that can actually use it — it is the option we want admins
  to reach for before bringing their own key. `sort-by` is stable, so everything else keeps its registry order."
  [provider-types]
  (sort-by (fn [{:keys [type managed?]}]
             (if (and managed? (llm.provider/type-available? type)) 0 1))
           provider-types))

(api.macros/defendpoint :get "/provider-types"
  :- [:sequential provider-type-response-schema]
  "List the provider types a connection can be created for, with the credential fields each one needs."
  []
  (perms/check-has-application-permission :setting)
  (mapv provider-type-response (offer-managed-first (llm.provider/provider-types))))

(api.macros/defendpoint :get "/providers"
  :- [:sequential connection-response-schema]
  "List the configured provider connections, with their secrets masked."
  []
  (perms/check-has-application-permission :setting)
  (mapv connection-response (llm.provider/connections)))

(api.macros/defendpoint :post "/providers"
  :- connection-response-schema
  "Create a provider connection. The credentials are verified before the connection is saved."
  [_route-params
   _query-params
   {:keys [type name key config model]} :- [:map
                                            [:type :string]
                                            [:name {:optional true} [:maybe :string]]
                                            [:key {:optional true} [:maybe :string]]
                                            [:config {:optional true} [:maybe config-schema]]
                                            [:model {:optional true} [:maybe :string]]]]
  (perms/check-has-application-permission :setting)
  (check-connections-not-env-managed!)
  (let [provider-type (llm.provider/provider-type type)]
    (api/check-400 provider-type (tru "Unknown provider type {0}." (pr-str type)))
    (api/check-400 (llm.provider/type-available? type)
                   (tru "The {0} provider is not available on this instance." (pr-str type)))
    (api/check-400 (not (and (llm.provider/singleton-type? type)
                             (some #(= type (:type %)) (llm.provider/connections))))
                   (tru "The {0} provider is already connected." (pr-str type)))
    (let [conn-key (llm.provider/unique-key (or (not-empty key) type))
          config   (or config {})
          conn     {:key    conn-key
                    :type   type
                    :name   (or (not-empty name) (str (:label provider-type)))
                    :config config}]
      (llm.provider/validate-config! type config)
      (verify-credentials! conn config model)
      (let [had-usable-model? (metabot-has-a-usable-model?)]
        (llm.provider/set-connections! (conj (llm.provider/stored-connections) conn))
        (when-not had-usable-model?
          (select-model-for-new-connection! conn model)))
      (connection-response (assoc conn :source :db)))))

(api.macros/defendpoint :put "/providers/:key"
  :- connection-response-schema
  "Update a provider connection. Secret fields the client echoes back masked keep their stored value."
  [{conn-key :key} :- [:map [:key connection-key-schema]]
   _query-params
   {:keys [name config model]} :- [:map
                                   [:name {:optional true} [:maybe :string]]
                                   [:config {:optional true} [:maybe config-schema]]
                                   [:model {:optional true} [:maybe :string]]]]
  (perms/check-has-application-permission :setting)
  (check-connections-not-env-managed!)
  (let [stored   (llm.provider/stored-connections)
        idx      (first (keep-indexed (fn [i c] (when (= (:key c) conn-key) i)) stored))
        _        (api/check-404 idx)
        existing (nth stored idx)
        _        (check-not-env-connection! (llm.provider/connection conn-key))
        merged   (cond-> existing
                   (some? config)     (assoc :config (llm.provider/merge-config (:type existing)
                                                                                (:config existing)
                                                                                config))
                   (not-empty name)   (assoc :name name))]
    (llm.provider/validate-config! (:type merged) (:config merged))
    (verify-credentials! merged (:config merged) model)
    (llm.provider/set-connections! (assoc stored idx merged))
    (follow-edited-connection-model! merged)
    (connection-response (assoc merged :source :db))))

(api.macros/defendpoint :delete "/providers/:key" :- :nil
  "Delete a provider connection."
  [{conn-key :key} :- [:map [:key connection-key-schema]]]
  (perms/check-has-application-permission :setting)
  (check-connections-not-env-managed!)
  (let [conn (llm.provider/connection conn-key)]
    (api/check-404 conn)
    (check-not-env-connection! conn)
    (when (llm.provider/managed-type? (:type conn))
      (cancel-managed-ai-subscription!))
    (let [remaining (vec (remove #(= (:key %) conn-key) (llm.provider/stored-connections)))]
      (llm.provider/set-connections! remaining)
      (when (= conn-key (llm.provider/model-ref->connection-key (metabot.settings/explicit-mini-model)))
        (setting/set! :llm-mini-model nil))
      (when (= conn-key (llm.provider/model-ref->connection-key (metabot.settings/llm-metabot-provider)))
        (setting/set! :llm-metabot-provider (fallback-model-ref)))))
  nil)

(api.macros/defendpoint :put "/provider-order"
  :- [:sequential connection-response-schema]
  "Set the order the provider connections are listed and fallen back to in.

  `order` is the full list of connection keys, top first. Keys that name a connection configured by the
  single-provider environment variables are ignored: those are appended after the stored ones on every read, so
  there is no position to save for them."
  [_route-params
   _query-params
   {:keys [order]} :- [:map [:order [:sequential connection-key-schema]]]]
  (perms/check-has-application-permission :setting)
  (check-connections-not-env-managed!)
  (let [stored    (llm.provider/stored-connections)
        by-key    (into {} (map (juxt :key identity)) stored)
        requested (filterv by-key order)]
    (api/check-400 (= (frequencies requested) (frequencies (map :key stored)))
                   (tru "The order must list every stored provider connection exactly once."))
    (llm.provider/set-connections! (mapv by-key requested))
    (mapv connection-response (llm.provider/connections))))

(api.macros/defendpoint :get "/active-model"
  :- active-model-response-schema
  "The model Metabot is running on right now, and the one it is configured to run on.

  These differ when the selected connection cannot serve requests and `llm-provider-fallback-enabled?` moved
  Metabot to the next connection in the list; `is_fallback` says whether that has happened."
  []
  (perms/check-has-application-permission :setting)
  (let [{:keys [model-ref selected-model-ref fallback]} (metabot.settings/metabot-model-selection)
        conn-key                                        (llm.provider/model-ref->connection-key model-ref)]
    {:model_ref          model-ref
     :model              (llm.provider/model-ref->model model-ref)
     :connection_key     conn-key
     :connection_name    (:name (llm.provider/connection conn-key))
     :selected_model_ref selected-model-ref
     :is_fallback        (some? fallback)}))

(api.macros/defendpoint :get "/models"
  :- models-response-schema
  "List the models available from every configured connection, grouped by connection.

  A connection whose credentials are rejected comes back with an empty model list and an `error`, so one bad
  connection does not blank out the others."
  []
  (perms/check-has-application-permission :setting)
  (into []
        (pmap connection-models-response (llm.provider/connections))))

(def ^{:arglists '([request respond raise])} routes
  "`/api/llm` provider routes."
  (api.macros/ns-handler *ns*))
