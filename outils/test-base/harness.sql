create or replace function public._t(uid text, label text, q text, attendu text default 'ok')
returns text language plpgsql as $$
declare r text; res text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  execute 'set local role authenticated';
  begin
    execute q into r;
    res := 'ok';
  exception when others then
    res := sqlerrm;
  end;
  execute 'reset role';
  if (attendu = 'ok' and res = 'ok') or (attendu <> 'ok' and position(attendu in res) > 0) then
    return 'PASS  ' || label || coalesce('  → ' || r, '') || case when res <> 'ok' then '  [' || res || ']' else '' end;
  end if;
  return 'FAIL  ' || label || '  attendu: ' || attendu || '  obtenu: ' || res;
end $$;
