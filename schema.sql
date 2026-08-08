-- ============================================================================
-- 꽁초헌터 Supabase 스키마 (여러 번 실행해도 안전합니다 - idempotent)
--
-- 사용 방법
-- 1) https://supabase.com 에서 새 프로젝트 생성 (무료 플랜)
-- 2) 좌측 메뉴 Authentication > Providers > Email 설정에서
--    "Confirm email"을 반드시 OFF로 꺼주세요.
--    (아이디+비밀번호만으로 가입 즉시 로그인되게 하기 위함입니다.
--     내부적으로는 아이디를 "아이디@gongchohunter.local" 형태의
--     가상 이메일로 변환해 Supabase Auth에 등록합니다.)
-- 3) 좌측 메뉴 SQL Editor에서 이 파일 전체를 붙여넣고 Run 실행
--    (이미 실행한 적이 있어도 다시 전체 실행하면 됩니다 - 기존 테이블/정책을
--     안전하게 건너뛰거나 갱신하도록 작성되어 있습니다)
-- 4) 좌측 메뉴 Project Settings > API 에서 Project URL / anon public key를
--    복사해 js/config.js 에 붙여넣기
-- 5) 사이트에서 본인 계정으로 회원가입한 뒤, SQL Editor에서 아래를 실행해 관리자 권한 부여
--      update public.profiles set is_admin = true where username = '본인아이디';
--    이후 admin.html에서 그 아이디/비밀번호로 로그인하면 신고 수정/삭제가 가능합니다.
--    (admin.html은 서버 실행 없이 GitHub Pages 등 순수 정적 호스팅에서도 동작합니다)
-- ============================================================================

-- 1. 회원 프로필 --------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  points integer not null default 0,
  reports_count integer not null default 0,
  is_admin boolean not null default false, -- true인 계정만 admin.html에서 신고 수정/삭제 가능
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists is_admin boolean not null default false;

alter table public.profiles enable row level security;
drop policy if exists "profiles_select_public" on public.profiles;
create policy "profiles_select_public" on public.profiles for select using (true);
drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles for update using (auth.uid() = id);

-- 2. 신고(꽁초 발생 구역) -------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  guest_name text, -- 화면에 표시되는 제보자 이름: 회원은 아이디, 비회원은 입력한 닉네임이 저장됨
  title text not null,
  description text,
  image_url text not null,
  latitude double precision not null,
  longitude double precision not null,
  address text,
  severity text not null default 'medium', -- 'critical'(매우 심각, 1㎡당 50개+) | 'severe'(심함, 30~49개) | 'medium'(보통, 10~29개) | 'slight'(약간, 9개 이하)
  likes_count integer not null default 0,
  cleanup_votes integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;
drop policy if exists "reports_select_public" on public.reports;
create policy "reports_select_public" on public.reports for select using (true);
drop policy if exists "reports_insert_anyone" on public.reports;
create policy "reports_insert_anyone" on public.reports for insert with check (true);
-- 예전 버전에 있던 "누구나 수정 가능" 공개 정책은 보안상 제거합니다.
drop policy if exists "reports_update_anyone" on public.reports;
-- 수정/삭제는 is_admin = true인 로그인 계정만 가능 (admin.html이 anon key + 이 정책으로 동작)
drop policy if exists "reports_update_admin" on public.reports;
create policy "reports_update_admin" on public.reports for update
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));
drop policy if exists "reports_delete_admin" on public.reports;
create policy "reports_delete_admin" on public.reports for delete
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

-- 3. 댓글 ----------------------------------------------------------------------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  author_name text not null default '익명 헌터',
  text text not null,
  created_at timestamptz not null default now()
);

alter table public.comments enable row level security;
drop policy if exists "comments_select_public" on public.comments;
create policy "comments_select_public" on public.comments for select using (true);
drop policy if exists "comments_insert_anyone" on public.comments;
create policy "comments_insert_anyone" on public.comments for insert with check (true);

-- 4. 좋아요 / 청소요청 로그 (비회원도 가능, 단순 카운트용) -----------------------
create table if not exists public.report_likes (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.reports(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.report_cleanup_votes (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.reports(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.report_likes enable row level security;
alter table public.report_cleanup_votes enable row level security;
drop policy if exists "report_likes_select_public" on public.report_likes;
create policy "report_likes_select_public" on public.report_likes for select using (true);
drop policy if exists "report_likes_insert_anyone" on public.report_likes;
create policy "report_likes_insert_anyone" on public.report_likes for insert with check (true);
drop policy if exists "report_cleanup_votes_select_public" on public.report_cleanup_votes;
create policy "report_cleanup_votes_select_public" on public.report_cleanup_votes for select using (true);
drop policy if exists "report_cleanup_votes_insert_anyone" on public.report_cleanup_votes;
create policy "report_cleanup_votes_insert_anyone" on public.report_cleanup_votes for insert with check (true);

-- 5. 포인트 적립 원장 (월간 랭킹 집계용) ----------------------------------------
create table if not exists public.point_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.point_events enable row level security;
drop policy if exists "point_events_select_public" on public.point_events;
create policy "point_events_select_public" on public.point_events for select using (true);

-- ============================================================================
-- 트리거: 신고/좋아요/청소요청 발생 시 자동으로 카운트·포인트 반영
-- (회원인 경우에만 포인트 적립, 비회원 활동은 카운트만 반영)
-- ============================================================================

-- 신고 등록 시
create or replace function public.handle_new_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    update public.profiles
      set reports_count = reports_count + 1,
          points = points + 10
      where id = new.user_id;

    insert into public.point_events (user_id, amount, reason)
      values (new.user_id, 10, 'report_created');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_new_report on public.reports;
create trigger trg_new_report
  after insert on public.reports
  for each row execute function public.handle_new_report();

-- 좋아요 시
create or replace function public.handle_new_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
begin
  update public.reports set likes_count = likes_count + 1
    where id = new.report_id
    returning user_id into owner_id;

  if owner_id is not null then
    update public.profiles set points = points + 2 where id = owner_id;
    insert into public.point_events (user_id, amount, reason)
      values (owner_id, 2, 'like_received');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_new_like on public.report_likes;
create trigger trg_new_like
  after insert on public.report_likes
  for each row execute function public.handle_new_like();

-- 청소요청 시
create or replace function public.handle_new_cleanup_vote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
begin
  update public.reports set cleanup_votes = cleanup_votes + 1
    where id = new.report_id
    returning user_id into owner_id;

  if owner_id is not null then
    update public.profiles set points = points + 3 where id = owner_id;
    insert into public.point_events (user_id, amount, reason)
      values (owner_id, 3, 'cleanup_vote_received');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_new_cleanup_vote on public.report_cleanup_votes;
create trigger trg_new_cleanup_vote
  after insert on public.report_cleanup_votes
  for each row execute function public.handle_new_cleanup_vote();

-- ============================================================================
-- Storage: 신고 사진 업로드용 공개 버킷
-- ============================================================================
insert into storage.buckets (id, name, public)
  values ('report-photos', 'report-photos', true)
  on conflict (id) do nothing;

drop policy if exists "report_photos_public_read" on storage.objects;
create policy "report_photos_public_read"
  on storage.objects for select
  using (bucket_id = 'report-photos');

drop policy if exists "report_photos_anyone_upload" on storage.objects;
create policy "report_photos_anyone_upload"
  on storage.objects for insert
  with check (bucket_id = 'report-photos');

drop policy if exists "report_photos_admin_delete" on storage.objects;
create policy "report_photos_admin_delete"
  on storage.objects for delete
  using (bucket_id = 'report-photos' and exists (
    select 1 from public.profiles where id = auth.uid() and is_admin = true
  ));
