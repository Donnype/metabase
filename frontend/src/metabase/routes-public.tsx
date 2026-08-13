import { PublicNotFound } from "metabase/public/components/PublicNotFound";
import PublicAction from "metabase/public/containers/PublicAction";
import PublicApp from "metabase/public/containers/PublicApp";
import { PublicOrEmbeddedDashboardPage } from "metabase/public/containers/PublicOrEmbeddedDashboard";
import { PublicOrEmbeddedQuestion } from "metabase/public/containers/PublicOrEmbeddedQuestion";
import type { RouteObject } from "metabase/router";

// Documents carry the rich text editing stack and the native query editor,
// which nothing else on a public page needs.
const publicDocument = () =>
  import("metabase/public/containers/PublicDocument").then(
    ({ PublicDocument }) => ({ Component: PublicDocument }),
  );

export const getRoutes = (): RouteObject[] => [
  {
    children: [
      {
        path: "public",
        element: <PublicApp />,
        children: [
          { path: "action/:uuid", element: <PublicAction /> },
          { path: "question/:uuid", element: <PublicOrEmbeddedQuestion /> },
          {
            path: "dashboard/:uuid/:tabSlug?",
            element: <PublicOrEmbeddedDashboardPage />,
          },
          { path: "document/:uuid", lazy: publicDocument },
          { path: "*", element: <PublicNotFound /> },
        ],
      },
      { path: "*", element: <PublicNotFound /> },
    ],
  },
];
