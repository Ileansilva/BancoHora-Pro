import { withSupabase } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.111.0/cors";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    return withSupabase({ auth: "user" }, async (request, ctx) => {
      if (request.method !== "POST") return json({ error: "Método não permitido" }, 405);

      const { companyId, email, fullName, role } = await request.json();
      if (!companyId || !email || !fullName || !["admin", "operator"].includes(role)) {
        return json({ error: "Dados inválidos" }, 400);
      }

      const currentUserId = ctx.userClaims?.id;
      if (!currentUserId) return json({ error: "Usuário não autenticado" }, 401);

      // Confirma que o chamador é o proprietário desta empresa. A consulta respeita RLS.
      const { data: membership, error: membershipError } = await ctx.supabase
        .from("company_members")
        .select("role")
        .eq("company_id", companyId)
        .eq("user_id", currentUserId)
        .eq("active", true)
        .maybeSingle();

      if (membershipError || membership?.role !== "owner") {
        return json({ error: "Somente o proprietário pode convidar usuários." }, 403);
      }

      const appUrl = Deno.env.get("APP_URL") || undefined;
      const { data: invited, error: inviteError } = await ctx.supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName },
        ...(appUrl ? { redirectTo: appUrl } : {}),
      });

      if (inviteError || !invited.user) {
        return json({ error: inviteError?.message || "Falha no convite" }, 400);
      }

      const { error: memberError } = await ctx.supabaseAdmin.from("company_members").insert({
        company_id: companyId,
        user_id: invited.user.id,
        role,
        full_name: fullName,
        active: true,
      });

      if (memberError) return json({ error: memberError.message }, 400);
      return json({ ok: true });
    })(req);
  },
};
