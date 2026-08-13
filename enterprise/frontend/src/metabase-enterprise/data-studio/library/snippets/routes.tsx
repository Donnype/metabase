import { PLUGIN_DEPENDENCIES } from "metabase/plugins";
import { Route } from "metabase/router";

import { ArchivedSnippetsPage } from "./pages/ArchivedSnippetsPage";
import { SnippetDependenciesPage } from "./pages/SnippetDependenciesPage";
import { EditSnippetPage, NewSnippetPage } from "./pages/lazy";

export function getDataStudioSnippetRoutes() {
  return (
    <>
      <Route path="snippets/new" element={<NewSnippetPage />} />
      <Route path="snippets/archived" element={<ArchivedSnippetsPage />} />
      <Route path="snippets/:snippetId" element={<EditSnippetPage />} />
      {PLUGIN_DEPENDENCIES.isEnabled && (
        <Route
          path="snippets/:snippetId/dependencies"
          element={<SnippetDependenciesPage />}
        >
          <Route index element={<PLUGIN_DEPENDENCIES.DependencyGraphPage />} />
        </Route>
      )}
    </>
  );
}
