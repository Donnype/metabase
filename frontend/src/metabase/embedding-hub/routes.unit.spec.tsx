import { renderWithProviders, screen } from "__support__/ui";
import { createMockState } from "metabase/redux/store/mocks";
import { Route } from "metabase/router";
import { createMockUser } from "metabase-types/api/mocks";

import { getEmbeddingHubRoutes } from "./routes";

/**
 * This spec asserts route-tree structure, not access policy, so the guard is
 * stubbed to allow by default. Setting `mockGuardDenies` makes it deny instead.
 */
let mockGuardDenies = false;

jest.mock("./route-guards", () => {
  const { Outlet } = jest.requireActual("metabase/router");
  return {
    CanAccessEmbeddingHub: () =>
      mockGuardDenies ? (
        <div data-testid="unauthorized-marker">{"Unauthorized"}</div>
      ) : (
        <Outlet />
      ),
  };
});

jest.mock("./components/EmbeddingHubLayout", () => {
  const { Outlet } = jest.requireActual("metabase/router");
  return {
    EmbeddingHubLayout: () => (
      <div data-testid="embedding-hub-layout">
        <Outlet />
      </div>
    ),
  };
});

// The page is stubbed: this spec is about which page each path resolves to,
// not about what a page renders.
jest.mock("./pages/GetStarted", () => ({
  EmbeddingHubGetStartedPage: () => (
    <div data-testid="get-started-page">{"Get started"}</div>
  ),
}));

jest.mock("./pages/EmbeddingHubSecurityPage", () => ({
  EmbeddingHubSecurityPage: () => (
    <div data-testid="security-page">{"Security"}</div>
  ),
}));

jest.mock("./pages/EmbeddingHubAuthenticationPage", () => ({
  EmbeddingHubAuthenticationPage: () => (
    <div data-testid="authentication-page">{"Authentication"}</div>
  ),
}));

jest.mock("./pages/EmbeddingHubPermissionsPage", () => ({
  EmbeddingHubPermissionsPage: () => (
    <div data-testid="permissions-page">{"Permissions"}</div>
  ),
}));

jest.mock("./pages/EmbeddingHubTenancyPage", () => ({
  EmbeddingHubTenancyPage: () => (
    <div data-testid="tenancy-page">{"Tenancy"}</div>
  ),
}));

jest.mock("./pages/EmbeddingHubAppearancePage", () => ({
  EmbeddingHubAppearancePage: () => (
    <div data-testid="theme-listing-page">{"Appearance"}</div>
  ),
}));

jest.mock("metabase/admin/embedding/components/ThemeEditor", () => ({
  EmbeddingThemeEditorApp: ({ basePath }: { basePath?: string }) => (
    <div data-testid="theme-editor-page">{basePath}</div>
  ),
}));

jest.mock("./pages/EmbeddingHubLocalizationPage", () => ({
  EmbeddingHubLocalizationPage: () => (
    <div data-testid="localization-page">{"Localization"}</div>
  ),
}));

jest.mock("metabase/embedding/setup-guide", () => ({
  SetupPermissionsAndTenantsPage: () => (
    <div data-testid="permissions-setup-page">{"Permissions setup"}</div>
  ),
  SetupSsoPage: () => <div data-testid="sso-setup-page">{"SSO setup"}</div>,
}));

function setup(initialRoute: string) {
  return renderWithProviders(
    <Route path="/">{getEmbeddingHubRoutes()}</Route>,
    {
      withRouter: true,
      initialRoute,
      storeInitialState: createMockState({
        currentUser: createMockUser({ is_superuser: true }),
      }),
    },
  );
}

describe("embedding hub routes", () => {
  afterEach(() => {
    mockGuardDenies = false;
  });

  it.each([
    ["/embedding/get-started", "get-started-page"],
    ["/embedding/get-started/permissions-setup", "permissions-setup-page"],
    ["/embedding/get-started/sso-setup", "sso-setup-page"],
    ["/embedding/security", "security-page"],
    ["/embedding/authentication", "authentication-page"],
    ["/embedding/permissions", "permissions-page"],
    ["/embedding/tenancy", "tenancy-page"],
    ["/embedding/localization", "localization-page"],
  ])("renders the body for %s", async (route, testId) => {
    setup(route);

    expect(await screen.findByTestId(testId)).toBeInTheDocument();
  });

  it("redirects the hub root to Get started", async () => {
    setup("/embedding");

    expect(await screen.findByTestId("get-started-page")).toBeInTheDocument();
  });

  it("renders the theme listing on the appearance tab", async () => {
    setup("/embedding/appearance");

    expect(await screen.findByTestId("theme-listing-page")).toBeInTheDocument();
  });

  it("renders the theme editor for a single theme, scoped to the hub path", async () => {
    setup("/embedding/appearance/12");

    expect(await screen.findByTestId("theme-editor-page")).toHaveTextContent(
      "/embedding/appearance",
    );
  });

  it("does not render anything when the guard denies access", async () => {
    mockGuardDenies = true;
    setup("/embedding");

    expect(
      await screen.findByTestId("unauthorized-marker"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("get-started-page")).not.toBeInTheDocument();
  });
});
