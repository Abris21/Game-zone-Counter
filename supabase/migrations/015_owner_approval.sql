alter table game_zones
  add column if not exists owner_approved boolean not null default true;