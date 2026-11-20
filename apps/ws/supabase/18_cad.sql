-- ============================================================================
-- 업무지원(WS) CAD — 변환된 도면(DXF) 목록 (docs/설계/WS_CAD.md 7장)
-- 실행: 16 다음에 SQL Editor 에 통째로 붙여 넣고 Run (여러 번 돌려도 안전)
--  · cad_file = 올린 도면 한 줄씩 (파일은 Storage ws-files/cad/YYYY-MM/…dxf, 구글 드라이브 사본 주소 drive_url)
--  · 뷰어(fm/cad)는 Supabase 에 직접 붙지 않고 업무지원 창의 WS_CAD 통로 → 이 함수들 (PIN 로그인 표 ws_auth)
--  · 보는 사람·올리는 사람: 전 직원 (사용자 11-20). 지우기는 소장만
--  · 분류(11-20): cad_cat(공조·소방·전기·건축 처음 제공) — 만들기 전 직원, 지우기 소장·부소장·관리자(지우면 그 분류 도면은 「미분류」). 18을 다시 Run 해도 안전
--  · 남용 막기: 파일 50MB 이하, 한 사람 하루 30건, 같은 이름은 새 파일로 바꿈(기록 한 줄 유지)
-- ============================================================================
create table if not exists public.cad_file (
  id         bigserial primary key,
  name       text not null,
  floor      text not null default '',
  memo       text not null default '',
  path       text not null,
  url        text not null,
  size       bigint not null default 0,
  drive_url  text not null default '',
  editor     text,
  created_at timestamptz not null default clock_timestamp()
);
create table if not exists public.cad_cat (
  id         bigserial primary key,
  name       text not null,
  editor     text,
  created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists cad_cat_name on public.cad_cat (lower(name));
alter table public.cad_cat enable row level security;
do $$ begin
  if not exists (select 1 from public.cad_cat) then
    insert into public.cad_cat (name, editor) values ('공조', '기본'), ('소방', '기본'), ('전기', '기본'), ('건축', '기본');
  end if;
end $$;
alter table public.cad_file add column if not exists cat_id bigint references public.cad_cat (id) on delete set null;   -- 분류를 지우면 비움 = 미분류
create unique index if not exists cad_file_name on public.cad_file (lower(name));
create index if not exists cad_file_at on public.cad_file (created_at desc);
alter table public.cad_file enable row level security;       -- 정책 없음 = 표를 직접 못 읽음 (함수로만)

-- 목록 (최근 200개) + 분류들. 뷰어 모양: items[{ id, name, floor, memo, by, date, size, url, cat_id, cat }], cats[{ id, name, n }]
create or replace function public.ws_cad_list(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.staff := public.ws_auth(p_token);
begin
  return jsonb_build_object('ok', true,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id::text, 'name', r.name, 'floor', r.floor, 'memo', r.memo,
      'by', r.editor, 'date', to_char(r.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'), 'size', r.size, 'url', r.url, 'drive_url', r.drive_url,
      'cat_id', r.cat_id, 'cat', coalesce((select c.name from public.cad_cat c where c.id = r.cat_id), '')) order by r.created_at desc), '[]'::jsonb)
      from (select * from public.cad_file order by created_at desc limit 200) r),
    'cats', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'n', (select count(*) from public.cad_file f where f.cat_id = c.id)) order by c.id), '[]'::jsonb)
      from public.cad_cat c),
    'can_del_cat', me.role in ('소장', '부소장', '관리자'));
end $$;

-- 올린 도면 기록. 같은 이름이 있으면 그 줄을 새 파일로 바꿈
create or replace function public.ws_cad_save(p_token text, p_r jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me public.staff := public.ws_auth(p_token); nid bigint; nm text := left(trim(coalesce(p_r->>'name', '')), 120); sz bigint; cid bigint;
begin
  if nm = '' then return jsonb_build_object('ok', false, 'error', '도면 이름이 없습니다'); end if;
  if coalesce(p_r->>'path', '') !~ '^cad/[0-9]{4}-[0-9]{2}/[0-9a-f]{32}\.dxf$' or coalesce(p_r->>'url', '') !~ '^https://' then
    return jsonb_build_object('ok', false, 'error', '도면 파일 경로가 맞지 않습니다'); end if;
  if coalesce(p_r->>'drive_url', '') <> '' and p_r->>'drive_url' !~ '^https://' then return jsonb_build_object('ok', false, 'error', '드라이브 주소가 맞지 않습니다'); end if;
  cid := case when coalesce(p_r->>'cat_id', '') ~ '^[0-9]+$' and exists (select 1 from public.cad_cat where id = (p_r->>'cat_id')::bigint) then (p_r->>'cat_id')::bigint end;
  sz := case when coalesce(p_r->>'size', '') ~ '^[0-9]+$' then (p_r->>'size')::bigint else 0 end;
  if sz > 50 * 1024 * 1024 then return jsonb_build_object('ok', false, 'error', '파일이 너무 큽니다 (50MB 넘음)'); end if;
  if (select count(*) from public.cad_file where editor = me.name and created_at > clock_timestamp() - interval '1 day') >= 30 then
    return jsonb_build_object('ok', false, 'error', '하루에 올릴 수 있는 도면(30개)을 넘었습니다'); end if;
  insert into public.cad_file (name, floor, memo, path, url, size, drive_url, editor, cat_id)
  values (nm, left(coalesce(p_r->>'floor', ''), 20), left(coalesce(p_r->>'memo', ''), 200), p_r->>'path', p_r->>'url', sz, coalesce(p_r->>'drive_url', ''), me.name, cid)
  on conflict (lower(name)) do update set floor = excluded.floor, memo = excluded.memo, path = excluded.path, url = excluded.url,
    size = excluded.size, drive_url = excluded.drive_url, cat_id = excluded.cat_id, editor = excluded.editor, created_at = excluded.created_at
  returning id into nid;
  perform public.ws_log(me.name, 'CAD 도면 올림', nm, coalesce(p_r->>'floor', ''));
  return jsonb_build_object('ok', true, 'id', nid::text);
end $$;

-- 지우기 (소장만): 목록에서만 뺌. 파일은 Storage·드라이브에 남음
create or replace function public.ws_cad_delete(p_token text, p_id bigint)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me public.staff := public.ws_boss(p_token); nm text;
begin
  delete from public.cad_file where id = p_id returning name into nm;
  if nm is null then return jsonb_build_object('ok', false, 'error', '도면이 없습니다'); end if;
  perform public.ws_log(me.name, 'CAD 도면 지움', nm, '');
  return jsonb_build_object('ok', true);
end $$;

-- 분류 만들기 (전 직원, 이름 1~20자, 최대 30개)
create or replace function public.ws_cad_cat_add(p_token text, p_name text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me public.staff := public.ws_auth(p_token); nm text := left(trim(coalesce(p_name, '')), 20); nid bigint;
begin
  if nm = '' then return jsonb_build_object('ok', false, 'error', '분류 이름을 적어 주세요'); end if;
  if (select count(*) from public.cad_cat) >= 30 then return jsonb_build_object('ok', false, 'error', '분류는 30개까지 만들 수 있습니다'); end if;
  if exists (select 1 from public.cad_cat where lower(name) = lower(nm)) then return jsonb_build_object('ok', false, 'error', '같은 이름의 분류가 이미 있습니다'); end if;
  insert into public.cad_cat (name, editor) values (nm, me.name) returning id into nid;
  perform public.ws_log(me.name, 'CAD 분류 만듦', nm, '');
  return jsonb_build_object('ok', true, 'id', nid);
end $$;

-- 분류 지우기 (소장·부소장·관리자): 그 분류 도면은 「미분류」로 (도면은 안 지워짐)
create or replace function public.ws_cad_cat_del(p_token text, p_id bigint)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me public.staff := public.ws_auth(p_token); nm text; n int;
begin
  if me.role not in ('소장', '부소장', '관리자') then return jsonb_build_object('ok', false, 'error', '분류 지우기는 소장·부소장·관리자만 할 수 있습니다'); end if;
  select count(*) into n from public.cad_file where cat_id = p_id;
  delete from public.cad_cat where id = p_id returning name into nm;
  if nm is null then return jsonb_build_object('ok', false, 'error', '분류가 없습니다'); end if;
  perform public.ws_log(me.name, 'CAD 분류 지움', nm, n || '개 미분류로');
  return jsonb_build_object('ok', true, 'moved', n);
end $$;

-- 도면 분류 바꾸기 (전 직원). 분류 없음(null) = 미분류
create or replace function public.ws_cad_set_cat(p_token text, p_id bigint, p_cat bigint)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me public.staff := public.ws_auth(p_token); nm text;
begin
  if p_cat is not null and not exists (select 1 from public.cad_cat where id = p_cat) then return jsonb_build_object('ok', false, 'error', '분류가 없습니다'); end if;
  update public.cad_file set cat_id = p_cat where id = p_id returning name into nm;
  if nm is null then return jsonb_build_object('ok', false, 'error', '도면이 없습니다'); end if;
  perform public.ws_log(me.name, 'CAD 분류 바꿈', nm, coalesce((select name from public.cad_cat where id = p_cat), '미분류'));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.ws_cad_list(text), public.ws_cad_save(text, jsonb), public.ws_cad_delete(text, bigint),
  public.ws_cad_cat_add(text, text), public.ws_cad_cat_del(text, bigint), public.ws_cad_set_cat(text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.ws_cad_list(text), public.ws_cad_save(text, jsonb), public.ws_cad_delete(text, bigint),
  public.ws_cad_cat_add(text, text), public.ws_cad_cat_del(text, bigint), public.ws_cad_set_cat(text, bigint, bigint) to authenticated;
