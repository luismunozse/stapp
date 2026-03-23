-- Tabla para registrar emails individuales enviados por el admin de organización
CREATE TABLE admin_emails (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sent_by TEXT NOT NULL REFERENCES users(id),
  destinatario_email TEXT NOT NULL,
  destinatario_nombre TEXT,
  destinatario_tipo TEXT, -- 'CLIENTE', 'TECNICO', 'VENDEDOR', 'OTRO'
  destinatario_id TEXT, -- ID del cliente/tecnico/vendedor si aplica
  asunto TEXT NOT NULL,
  contenido TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'ENVIADO', -- 'ENVIADO', 'ERROR'
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX admin_emails_org_idx ON admin_emails(organization_id);
CREATE INDEX admin_emails_org_created_idx ON admin_emails(organization_id, created_at);
CREATE INDEX admin_emails_destinatario_idx ON admin_emails(destinatario_email);
