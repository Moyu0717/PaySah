INSERT INTO users(id,tenant_id,display_name,role) SELECT gen_random_uuid(),id,'Receipt intake system','SYSTEM' FROM tenants WHERE is_demo ON CONFLICT(tenant_id) WHERE role='SYSTEM' DO NOTHING;
