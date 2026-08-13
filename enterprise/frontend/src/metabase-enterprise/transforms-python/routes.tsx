import { modalRoute } from "metabase/common/components/ModalRoute";
import { Route } from "metabase/router";
import { TransformListPage } from "metabase/transforms/pages/TransformListPage";

import { PythonTransformsUpsellModal } from "./upsells/PythonTransformsUpsellModal";

// Both pages render the Python editor, which pulls in CodeMirror's Python
// language mode. This plugin registers eagerly, so they load on demand.
const pythonLibraryEditorPage = () =>
  import("./pages/PythonLibraryEditorPage").then(
    ({ PythonLibraryEditorPage }) => ({ Component: PythonLibraryEditorPage }),
  );

const newPythonTransformPage = () =>
  import("metabase/transforms/pages/NewTransformPage").then(
    ({ NewPythonTransformPage }) => ({ Component: NewPythonTransformPage }),
  );

export function getPythonTransformsRoutes() {
  return (
    <>
      <Route path="library/:path" lazy={pythonLibraryEditorPage} />
      <Route path="new/python" lazy={newPythonTransformPage} />
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
