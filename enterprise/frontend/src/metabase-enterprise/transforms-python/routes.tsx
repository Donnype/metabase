import { modalRoute } from "metabase/common/components/ModalRoute";
import { Route } from "metabase/router";
import { NewPythonTransformPage } from "metabase/transforms/pages/NewTransformPage";
import { TransformListPage } from "metabase/transforms/pages/TransformListPage";

import { PythonTransformsUpsellModal } from "./upsells/PythonTransformsUpsellModal";

// Only the library editor is deferred. The other two pages come from
// `metabase/transforms`, which the core transform routes already import, so
// naming them in an `import()` here would move nothing.
const pythonLibraryEditorPage = () =>
  import("./pages/PythonLibraryEditorPage").then(
    ({ PythonLibraryEditorPage }) => ({ Component: PythonLibraryEditorPage }),
  );

export function getPythonTransformsRoutes() {
  return (
    <>
      <Route path="library/:path" lazy={pythonLibraryEditorPage} />
      <Route path="new/python" element={<NewPythonTransformPage />} />
    </>
  );
}

export function getPythonUpsellRoutes() {
  return (
    // Render upsell modal on python transforms routes if feature is not enabled
    <Route path="" element={<TransformListPage />}>
      {modalRoute("library/:path", PythonTransformsUpsellModal, {
        noWrap: true,
      })}
      {modalRoute("new/python", PythonTransformsUpsellModal, {
        noWrap: true,
      })}
    </Route>
  );
}
