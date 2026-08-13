import { PLUGIN_DEPENDENCIES } from "metabase/plugins";
import { Route } from "metabase/router";

import { ArchivedSnippetsPage } from "./pages/ArchivedSnippetsPage";
import { SnippetDependenciesPage } from "./pages/SnippetDependenciesPage";

// Both snippet pages render a CodeMirror editor. They sit behind an enterprise
// plugin that registers eagerly, so without their own chunk every EE page load
// pays for the editor.
const newSnippetPage = () =>
  import("./pages/NewSnippetPage").then(({ NewSnippetPage }) => ({
    Component: NewSnippetPage,
  }));

const editSnippetPage = () =>
  import("./pages/EditSnippetPage").then(({ EditSnippetPage }) => ({
    Component: EditSnippetPage,
  }));

export function getDataStudioSnippetRoutes() {
  return (
    <>
      <Route path="snippets/new" lazy={newSnippetPage} />
      <Route path="snippets/archived" element={<ArchivedSnippetsPage />} />
      <Route path="snippets/:snippetId" lazy={editSnippetPage} />
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
