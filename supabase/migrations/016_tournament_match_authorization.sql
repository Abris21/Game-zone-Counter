create or replace function record_match_result(
  p_match uuid,
  p_score1 int,
  p_score2 int,
  p_winner uuid,
  p_walkover boolean default false
) returns void language plpgsql security definer set search_path=public as $$
declare
  m tournament_matches;
  nx tournament_matches;
  t tournaments;
  z uuid := my_zone();
begin
  if my_role() <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  if z is null then raise exception 'NOT_ALLOWED'; end if;
  if p_walkover is null or p_score1 is null or p_score2 is null or p_score1 < 0 or p_score2 < 0 then
    raise exception 'INVALID_MATCH_RESULT';
  end if;

  select * into m from tournament_matches where id = p_match and zone_id = z for update;
  if not found then raise exception 'NOT_ALLOWED'; end if;
  if m.player1_id is null or m.player2_id is null then raise exception 'INVALID_MATCH_RESULT'; end if;
  if p_winner is null or p_winner not in (m.player1_id, m.player2_id) then raise exception 'INVALID_MATCH_RESULT'; end if;
  if not p_walkover and (
    p_score1 = p_score2 or
    (p_score1 > p_score2 and p_winner <> m.player1_id) or
    (p_score2 > p_score1 and p_winner <> m.player2_id)
  ) then raise exception 'INVALID_MATCH_RESULT'; end if;

  select * into t from tournaments where id = m.tournament_id for update;
  if t.status <> 'in_progress' then raise exception 'INVALID_MATCH_RESULT'; end if;

  if m.next_match_id is not null then
    select * into nx from tournament_matches where id = m.next_match_id;
    if nx.status in ('completed', 'walkover') then raise exception 'MATCH_LOCKED'; end if;
  end if;

  update tournament_matches
  set score1 = greatest(0, coalesce(p_score1, 0)),
      score2 = greatest(0, coalesce(p_score2, 0)),
      winner_id = p_winner,
      status = case when p_walkover then 'walkover' else 'completed' end
  where id = m.id;

  if m.next_match_id is not null then
    if m.next_match_slot = 1 then
      update tournament_matches set player1_id = p_winner where id = m.next_match_id;
    else
      update tournament_matches set player2_id = p_winner where id = m.next_match_id;
    end if;
  else
    update tournaments set winner_id = p_winner, status = 'completed' where id = t.id;
    insert into audit_logs(zone_id, user_id, action, entity, entity_id, new_state)
    values(z, auth.uid(), 'tournament_completed', 'tournament', t.id, jsonb_build_object('winner_id', p_winner));
  end if;

  insert into audit_logs(zone_id, user_id, action, entity, entity_id, new_state)
  values(z, auth.uid(), 'record_match_result', 'tournament_match', m.id, jsonb_build_object(
    'score1', p_score1,
    'score2', p_score2,
    'winner_id', p_winner,
    'walkover', p_walkover
  ));
end$$;