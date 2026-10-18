-- Audit logs contain cross-zone security and financial activity; reserve reads for super admins.
DROP POLICY au_sel ON audit_logs;
CREATE POLICY au_sel ON audit_logs FOR SELECT USING (my_role() = 'super_admin');