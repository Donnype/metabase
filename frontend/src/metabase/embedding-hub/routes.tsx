import { EmbeddingThemeEditorApp } from "metabase/admin/embedding/components/ThemeEditor";
import { getRoutes as getAdminPermissionsRoutes } from "metabase/admin/permissions/routes";
import { UpsellTenants } from "metabase/admin/upsells";
import {
  SetupPermissionsAndTenantsPage,
  SetupSsoPage,
} from "metabase/embedding/setup-guide";
import { PLUGIN_TENANTS } from "metabase/plugins";
import { Navigate, Route } from "metabase/router";
import * as Urls from "metabase/urls";

import { EmbeddingHubLayout } from "./components/EmbeddingHubLayout";
import {
  EmbeddingHubAppearancePage,
  EmbeddingHubAuthenticationPage,
  EmbeddingHubGetStartedPage,
  EmbeddingHubPermissionsPage,
  EmbeddingHubSecurityPage,
  EmbeddingHubTenancyPage,
} from "./pages";
import { CanAccessEmbeddingHub } from "./route-guards";

/**
 * Every tab owns a path segment, and `/embedding` redirects to the first one,
 * so no tab's path is a prefix of another's. The remaining tabs arrive with
 * their own issues, each adding a route here, an export to `pages/index.ts` and
 * a tab to the nav.
 *
 * The two setup wizards nest under Get started because they belong to it: that
 * keeps its tab selected while they are open, without listing their paths
 * anywhere.
 */
export function getEmbeddingHubRoutes() {
  return (
    <Route element={<CanAccessEmbeddingHub />}>
      <Route
        path={Urls.EMBEDDING_HUB_ROOT_PATH}
        element={<EmbeddingHubLayout />}
      >
        <Route
          index
          element={<Navigate to={Urls.embeddingHubGetStarted()} replace />}
        />

        <Route path="get-started">
          <Route index element={<EmbeddingHubGetStartedPage />} />
          <Route
            path="permissions-setup"
            element={<SetupPermissionsAndTenantsPage />}
          />
          <Route path="sso-setup" element={<SetupSsoPage />} />
        </Route>

        <Route path="security" element={<EmbeddingHubSecurityPage />} />
        <Route
          path="authentication"
          element={<EmbeddingHubAuthenticationPage />}
        />
        <Route path="permissions" element={<EmbeddingHubPermissionsPage />}>
          {getAdminPermissionsRoutes()}
        </Route>
        <Route path="tenancy" element={<EmbeddingHubTenancyPage />}>
          {/* Null on OSS, and on EE it is assigned during plugin init. The
              fallback mirrors admin's: without it the tab would have no child
              routes at all if this tree were ever built before init runs. */}
          {PLUGIN_TENANTS.tenantsRoutes ?? (
            <Route index element={<UpsellTenants />} />
          )}
        </Route>
        <Route path="appearance">
          <Route index element={<EmbeddingHubAppearancePage />} />
          <Route
            path=":themeId"
            element={
              <EmbeddingThemeEditorApp
                basePath={Urls.embeddingHubAppearance()}
              />
            }
          />
        </Route>
      </Route>
    </Route>
  );
}
