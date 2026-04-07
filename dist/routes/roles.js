import { PUBLIC_ROLES, DEFAULT_ROLE_ID } from "../prompts/personas.js";
const rolesRoutes = async (app) => {
    app.get("/roles", async () => {
        return {
            ok: true,
            defaultRoleId: DEFAULT_ROLE_ID,
            roles: PUBLIC_ROLES
        };
    });
};
export default rolesRoutes;
