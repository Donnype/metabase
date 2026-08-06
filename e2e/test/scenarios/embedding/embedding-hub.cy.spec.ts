const { H } = cy;

/**
 * The embedding hub at `/embedding` -- the tabbed section, not the older
 * onboarding checklist that `embedding-hub/embedding-hub.cy.spec.ts` covers.
 *
 * Deliberately thin: the tab bodies are unit-tested next to their components.
 * What is here is what needs a real browser -- that a route fragment written
 * for admin renders correctly at a second path, and that its links do not
 * escape back into admin.
 *
 * Each tab adds its own assertions here as it lands, so no test outruns the
 * nav it asserts on.
 */
describe("scenarios > embedding > embedding hub", () => {
  describe("pro", () => {
    beforeEach(() => {
      H.restore();
      cy.signInAsAdmin();
      H.activateToken("pro-self-hosted");
    });

    it("keeps the permissions editor's links inside the hub", () => {
      H.updateSetting("use-tenants", true);

      cy.visit("/embedding/permissions");

      cy.log("The editor renders at the hub's path, not admin's");
      cy.url().should("include", "/embedding/permissions");

      cy.log("Drilling into a group stays in the hub");
      cy.findByTestId("permission-table").findAllByRole("link").first().click();

      cy.url().should("include", "/embedding/permissions");
      cy.url().should("not.include", "/admin/permissions");
    });

    it("lists published guest embeds even after guest embeds are switched off", () => {
      cy.log("Publish a dashboard as a guest embed");
      H.createDashboard({ name: "Published dashboard" }).then(
        ({ body: dashboard }) => {
          cy.request("PUT", `/api/dashboard/${dashboard.id}`, {
            enable_embedding: true,
          });
        },
      );

      H.updateSetting("enable-embedding-static", true);
      cy.visit("/embedding/security");

      cy.findByTestId("embedding-hub-main").within(() => {
        cy.findByText("Published guest embeds").should("be.visible");
        cy.findByText("Published dashboard").should("be.visible");
      });

      cy.log(
        "Turning guest embeds off is exactly when an admin needs to audit what is already out there",
      );
      H.updateSetting("enable-embedding-static", false);
      cy.visit("/embedding/security");

      cy.findByTestId("embedding-hub-main").within(() => {
        cy.findByText("Published guest embeds").should("be.visible");
        cy.findByText("Published dashboard").should("be.visible");
      });
    });
  });
});
