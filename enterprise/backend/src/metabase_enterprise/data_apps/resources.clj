(ns metabase-enterprise.data-apps.resources
  "Lifecycle for the permission group and resource collection owned by a data app.

   A data app owns a resource only through its `permission_group_id` /
   `resource_collection_id` foreign keys. The `Data App: <slug>` name is a display
   label, never an ownership claim: adopting a same-named group would hand its
   existing members the app's data access on a name match alone, so a collision is
   reported for an operator to resolve instead."
  (:require
   [metabase.permissions.core :as perms]
   [metabase.util :as u]
   [metabase.util.i18n :refer [tru]]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(defn- resource-name [app]
  (format "Data App: %s" (:name app)))

(defn- check-group-name-available [group-name]
  (when (t2/exists? :model/PermissionsGroup :%lower.name (u/lower-case-en group-name))
    (throw
     (ex-info
      (tru "A group named \"{0}\" exists and is not owned by this data app. Rename or delete it, then sync again."
           group-name)
      {:status-code 409, :group-name group-name}))))

(defn- create-permission-group! [app]
  (let [group-name (resource-name app)
        _          (check-group-name-available group-name)
        group      (t2/insert-returning-instance! :model/PermissionsGroup :name group-name)]
    (t2/update! :model/DataApp :id (:id app) {:permission_group_id (:id group)})
    group))

(defn- permission-group! [app]
  (or (some->> (:permission_group_id app)
               (t2/select-one :model/PermissionsGroup :id))
      (create-permission-group! app)))

(defn- restrict-query-creation! [group]
  (let [database-ids (t2/select-pks-set :model/Database :router_database_id nil)
        permissions  (or (perms/index-database-permissions [(:id group)] database-ids) {})]
    (doseq [database-id database-ids
            :let [current-value (some-> permissions
                                        (get [(:id group) database-id :perms/create-queries])
                                        first
                                        :perm_value)]
            :when (not= current-value :no)]
      (perms/set-database-permission! permissions group database-id :perms/create-queries :no))))

(defn- create-resource-collection! [app]
  (let [collection (t2/insert-returning-instance! :model/Collection
                                                  :name (resource-name app)
                                                  :location "/")]
    (t2/update! :model/DataApp :id (:id app) {:resource_collection_id (:id collection)})
    (doseq [group (t2/select :model/PermissionsGroup)
            :when (not= (:id group) (:id (perms/admin-group)))]
      (perms/revoke-collection-permissions! group collection))
    collection))

(defn- resource-collection! [app]
  (or (some->> (:resource_collection_id app)
               (t2/select-one :model/Collection :id))
      (create-resource-collection! app)))

(defn ensure-resources!
  "Create or restore the server-owned permission resources for `app` and return their IDs.

   Transactional: a resource is created and claimed by `app` together, so a failure
   part-way can never leave an unclaimed `Data App: <slug>` behind to block later syncs."
  [app]
  (perms/with-global-permissions-lock
    (t2/with-transaction [_conn]
      ;; Re-read under the lock: a concurrent sync of the same app may have claimed
      ;; its resources since `app` was fetched, and acting on the stale row would
      ;; create a second group whose name its own app already holds.
      (let [app        (or (t2/select-one [:model/DataApp :id :name :permission_group_id :resource_collection_id]
                                          :id (:id app))
                           app)
            label      (resource-name app)
            group      (permission-group! app)
            collection (resource-collection! app)]
        (when (not= (:name group) label)
          (check-group-name-available label)
          (t2/update! :model/PermissionsGroup :id (:id group) {:name label}))
        (when (not= (:name collection) label)
          (t2/update! :model/Collection :id (:id collection) {:name label}))
        (restrict-query-creation! group)
        (doseq [permission-group (t2/select :model/PermissionsGroup)
                :when (not= (:id permission-group) (:id (perms/admin-group)))]
          (perms/revoke-collection-permissions! permission-group collection))
        (perms/grant-collection-read-permissions! group collection)
        {:permission_group_id    (:id group)
         :resource_collection_id (:id collection)}))))

(defn reconcile-view-data!
  "Make `database-ids` the authoritative view-data permission set for `app`."
  [app database-ids]
  (ensure-resources! app)
  (let [app (t2/select-one :model/DataApp :id (:id app))]
    (perms/with-global-permissions-lock
      (t2/with-transaction [_conn]
        (let [group            (permission-group! app)
              all-database-ids (t2/select-pks-set :model/Database :router_database_id nil)
              permissions     (or (perms/index-database-permissions [(:id group)] all-database-ids) {})]
          (doseq [database-id all-database-ids]
            (perms/set-database-permission! permissions group database-id :perms/view-data
                                            (if (contains? database-ids database-id)
                                              :unrestricted
                                              :blocked))))))))

(defn delete-resources!
  "Delete the generated collection and permission group referenced by `app`."
  [{:keys [permission_group_id resource_collection_id]}]
  (when resource_collection_id
    (t2/delete! :model/Collection :id resource_collection_id))
  (when permission_group_id
    (t2/delete! :model/PermissionsGroup :id permission_group_id)))
