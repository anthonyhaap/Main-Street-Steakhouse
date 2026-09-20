-- ============================================================================
-- League-specific reactions: a flame and a skull were never going to cover a
-- fantasy league's actual vocabulary.
--
-- The palette is a CHECK constraint rather than free text (20260906131812's
-- own argument: anything a manager can type is something a manager can type
-- AT somebody), so growing it is a schema change rather than a settings
-- toggle. This adds five entries a league actually reaches for — a trash can
-- for a bad take, salt for a sore loser, a clown for a bad process, and two
-- words the emoji keyboard has no glyph for at all. Word reactions are not a
-- special case anywhere downstream: the column is `text`, the client renders
-- whatever string comes back, and `ff_react`/`ff_reactions_for` never look at
-- the value beyond passing it through.
--
-- Ledger refresh:
--   select version, name from supabase_migrations.schema_migrations order by version;
-- ============================================================================

alter table public.reactions drop constraint if exists reactions_emoji_check;
alter table public.reactions add constraint reactions_emoji_check
  check (emoji in ('🔥','😂','💀','👀','🫡','🥩','🗑️','🧂','🤡','COOKED','FRAUD'));

comment on column public.reactions.emoji is
  'One of the league''s fixed palette: six original tallies plus 🗑️/🧂/🤡 and the word reactions COOKED/FRAUD, widened by 20260919010000. Anything a manager can type is something a manager can type at somebody, so this stays a CHECK, not free text.';
