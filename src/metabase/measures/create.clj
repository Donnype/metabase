(ns metabase.measures.create
  "Measure creation shared by REST and domain workflows."
  (:require
   [metabase.api.common :as api]
   [metabase.events.core :as events]
   [metabase.lib-be.core :as lib-be]
   [metabase.lib.core :as lib]
   [metabase.util.i18n :refer [tru]]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(defn normalize-input-definition
  "Normalize a Measure definition from API input to MBQL5."
  [definition]
  (if (seq definition)
    (-> (case (lib/normalized-mbql-version definition)
          (:mbql-version/mbql5 :mbql-version/legacy)
          definition

          (let [table-id    (:source-table definition)
                _           (api/check-400 (pos-int? table-id)
                                           (tru "Measure definition must specify a source table."))
                database-id (t2/select-one-fn :db_id :model/Table :id table-id)]
            {:database database-id
             :type     :query
             :query    definition}))
        lib-be/normalize-query)
    {}))

(defn definition-table-id
  "Derive the source table ID from a normalized Measure definition."
  [normalized-definition]
  (api/check-400 (when (seq normalized-definition)
                   (lib/primary-source-table-id normalized-definition))
                 (tru "Measure definition must specify a source table.")))

(defn create!
  "Create and return a hydrated Measure through the standard permission and event path."
  [{:keys [name description definition], :as body}]
  (let [normalized-definition (normalize-input-definition definition)
        table-id              (definition-table-id normalized-definition)]
    (api/create-check :model/Measure (assoc body :table_id table-id))
    (let [measure (api/check-500
                   (first (t2/insert-returning-instances! :model/Measure
                                                          :creator_id  api/*current-user-id*
                                                          :name        name
                                                          :description description
                                                          :definition  normalized-definition)))]
      (events/publish-event! :event/measure-create {:object measure :user-id api/*current-user-id*})
      (t2/hydrate measure :creator))))
