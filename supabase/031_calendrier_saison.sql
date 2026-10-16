-- =====================================================================
--  031 – Calendrier 2026-2027 des trois équipes (CPARD)
--  - Ajoute la « date limite » d'une journée : tant que la date exacte
--    n'est pas fixée, la rencontre s'affiche « entre le … et le … »
--  - Charge les salles adverses et les 38 rencontres de la saison,
--    avec les résultats déjà connus
--  À exécuter une fois dans Supabase (SQL Editor), après le script 030.
--  Peut être relancé sans créer de doublon.
-- =====================================================================

alter table public.rencontres add column if not exists date_fin date;
alter table public.rencontres drop constraint if exists rencontres_date_fin;
alter table public.rencontres add constraint rencontres_date_fin check (date_fin is null or date_fin >= date_match);

-- Salles adverses
insert into public.salles (nom, adresse, created_by) values
 ('Patrick''s – Le Ballon Vert', '33 rue de Montreuil, 75011 Paris', null),
 ('Bar Le Sputnik', '14-16 rue de la Butte-aux-Cailles, 75013 Paris', null),
 ('École Politzer (ARMY 78)', '1 rue Youri Gagarine, 78280 Guyancourt', null),
 ('Salle Team Darts 95', '23 rue des Cordonniers, 95570 Bouffémont', null),
 ('Foyer des sports (CAL)', '42 avenue du Général de Gaulle, 94240 L''Haÿ-les-Roses', null),
 ('L''Atelier Montmartre', '6 rue Burq, 75018 Paris', null),
 ('L''AlbaR', '4 rue Poissonnière, 75002 Paris', null),
 ('Le Dikkenek', '59 rue Ramey, 75018 Paris', null),
 ('Salle SMFE 91', '2 place Léonard de Vinci, 91240 Saint-Michel-sur-Orge', null),
 ('Salle ECDC', '2 mail de Thorigny, 91080 Évry-Courcouronnes', null),
 ('Darts Unesco Club (DUC)', '7 place de Fontenoy, 75007 Paris', null)
on conflict do nothing;

-- Rencontres (une seule fois par équipe, journée et adversaire)
with donnees (equipe, division, poule, journee, date_match, date_fin, adversaire, domicile, salle, score_nous, score_eux) as (values
  ('Dolina 1', '1', 'C', 'J1', date '2026-09-28', null::date, 'HODC 1', false, null, 16, 4),
  ('Dolina 1', '1', 'C', 'J2', date '2026-10-08', null::date, 'Team Darts 95', false, 'Salle Team Darts 95', 14, 6),
  ('Dolina 1', '1', 'C', 'J3', date '2026-10-29', null::date, 'Sputnik 4', true, 'Gymnase Paul Souriau (Dolina)', null::smallint, null::smallint),
  ('Dolina 1', '1', 'C', 'J4', date '2026-11-09', date '2026-11-21', 'PDC 1', true, 'Gymnase Paul Souriau (Dolina)', null::smallint, null::smallint),
  ('Dolina 1', '1', 'C', 'J5', date '2026-11-23', date '2026-12-05', 'CAL 1', false, 'Foyer des sports (CAL)', null::smallint, null::smallint),
  ('Dolina 1', '1', 'C', 'J6', date '2026-12-07', date '2026-12-19', 'HODC 1', true, 'Gymnase Paul Souriau (Dolina)', null::smallint, null::smallint),
  ('Dolina 1', '1', 'C', 'J7', date '2027-01-11', date '2027-01-23', 'Team Darts 95', true, 'Gymnase Paul Souriau (Dolina)', null::smallint, null::smallint),
  ('Dolina 1', '1', 'C', 'J8', date '2027-01-25', date '2027-02-13', 'Sputnik 4', false, 'Bar Le Sputnik', null::smallint, null::smallint),
  ('Dolina 1', '1', 'C', 'J9', date '2027-02-15', date '2027-03-06', 'PDC 1', false, 'Patrick''s – Le Ballon Vert', null::smallint, null::smallint),
  ('Dolina 1', '1', 'C', 'J10', date '2027-03-08', date '2027-03-20', 'CAL 1', true, 'Gymnase Paul Souriau (Dolina)', null::smallint, null::smallint),
  ('Dolina 2', '1', 'B', 'J1', date '2026-09-28', null::date, 'Sputnik 1', false, 'Bar Le Sputnik', 2, 18),
  ('Dolina 2', '1', 'B', 'J2', date '2026-10-05', date '2026-10-17', 'Darting Club', true, 'Gymnase Paul Souriau (Dolina)', 8, 12),
  ('Dolina 2', '1', 'B', 'J3', date '2026-10-19', date '2026-11-07', 'LTC 1', true, 'Gymnase Paul Souriau (Dolina)', null::smallint, null::smallint),
  ('Dolina 2', '1', 'B', 'J4', date '2026-11-09', date '2026-11-21', 'UGDC 1', false, 'L''Atelier Montmartre', null::smallint, null::smallint),
  ('Dolina 2', '1', 'B', 'J5', date '2026-11-23', date '2026-12-05', 'DUC', true, 'Gymnase Paul Souriau (Dolina)', null::smallint, null::smallint),
  ('Dolina 2', '1', 'B', 'J6', date '2026-12-07', date '2026-12-19', 'Sputnik 1', true, 'Gymnase Paul Souriau (Dolina)', null::smallint, null::smallint),
  ('Dolina 2', '1', 'B', 'J7', date '2027-01-11', date '2027-01-23', 'Darting Club', false, 'L''AlbaR', null::smallint, null::smallint),
  ('Dolina 2', '1', 'B', 'J8', date '2027-01-25', date '2027-02-13', 'LTC 1', false, 'Le Dikkenek', null::smallint, null::smallint),
  ('Dolina 2', '1', 'B', 'J9', date '2027-02-15', date '2027-03-06', 'UGDC 1', true, 'Gymnase Paul Souriau (Dolina)', null::smallint, null::smallint),
  ('Dolina 2', '1', 'B', 'J10', date '2027-03-08', date '2027-03-20', 'DUC', false, 'Darts Unesco Club (DUC)', null::smallint, null::smallint),
  ('Dolinos', '2', null, 'J1', date '2026-10-01', null::date, 'ECDC 1', true, 'Gymnase Paul Souriau (Dolina)', 7, 13),
  ('Dolinos', '2', null, 'J2', date '2026-10-16', null::date, 'SMFE 91 3', false, 'Salle SMFE 91', null::smallint, null::smallint),
  ('Dolinos', '2', null, 'J3', date '2026-10-19', date '2026-11-07', 'UGDC 3', false, 'L''Atelier Montmartre', null::smallint, null::smallint),
  ('Dolinos', '2', null, 'J4', date '2026-11-09', date '2026-11-21', 'CAL 3', false, 'Foyer des sports (CAL)', null::smallint, null::smallint),
  ('Dolinos', '2', null, 'J5', date '2026-11-23', date '2026-12-05', 'Patrick''s 3', true, 'Gymnase Paul Souriau (Dolina)', null::smallint, null::smallint),
  ('Dolinos', '2', null, 'J6', date '2026-12-07', date '2026-12-19', 'Sputnik 2', false, 'Bar Le Sputnik', null::smallint, null::smallint),
  ('Dolinos', '2', null, 'J7', date '2027-01-04', date '2027-01-16', 'LTC 2', false, 'Le Dikkenek', null::smallint, null::smallint),
  ('Dolinos', '2', null, 'J8', date '2027-01-18', date '2027-01-30', 'Sputnik 5', true, 'Gymnase Paul Souriau (Dolina)', null::smallint, null::smallint),
  ('Dolinos', '2', null, 'J9', date '2027-02-01', date '2027-02-20', 'ARMY 78 2', true, 'Gymnase Paul Souriau (Dolina)', null::smallint, null::smallint),
  ('Dolinos', '2', null, 'J10', date '2027-02-22', date '2027-03-06', 'ECDC 1', false, 'Salle ECDC', null::smallint, null::smallint),
  ('Dolinos', '2', null, 'J11', date '2027-03-08', date '2027-03-20', 'SMFE 91 3', true, 'Gymnase Paul Souriau (Dolina)', null::smallint, null::smallint),
  ('Dolinos', '2', null, 'J12', date '2027-03-22', date '2027-04-03', 'UGDC 3', true, 'Gymnase Paul Souriau (Dolina)', null::smallint, null::smallint),
  ('Dolinos', '2', null, 'J13', date '2027-04-05', date '2027-04-24', 'CAL 3', true, 'Gymnase Paul Souriau (Dolina)', null::smallint, null::smallint),
  ('Dolinos', '2', null, 'J14', date '2027-04-26', date '2027-05-08', 'Patrick''s 3', false, 'Patrick''s – Le Ballon Vert', null::smallint, null::smallint),
  ('Dolinos', '2', null, 'J15', date '2027-05-10', date '2027-05-22', 'Sputnik 2', true, 'Gymnase Paul Souriau (Dolina)', null::smallint, null::smallint),
  ('Dolinos', '2', null, 'J16', date '2027-05-24', date '2027-06-05', 'LTC 2', true, 'Gymnase Paul Souriau (Dolina)', null::smallint, null::smallint),
  ('Dolinos', '2', null, 'J17', date '2027-06-07', date '2027-06-19', 'Sputnik 5', false, 'Bar Le Sputnik', null::smallint, null::smallint),
  ('Dolinos', '2', null, 'J18', date '2027-06-21', date '2027-06-30', 'ARMY 78 2', false, 'École Politzer (ARMY 78)', null::smallint, null::smallint)
)
insert into public.rencontres (team_id, division, poule, journee, date_match, date_fin, adversaire, domicile, salle_id, score_nous, score_eux, created_by)
select t.id, d.division, d.poule, d.journee, d.date_match, d.date_fin, d.adversaire, d.domicile, s.id, d.score_nous, d.score_eux, null
from donnees d
join public.teams t on t.name = d.equipe
left join public.salles s on lower(s.nom) = lower(d.salle)
where not exists (
  select 1 from public.rencontres r
  where r.team_id = t.id and r.journee = d.journee and r.adversaire = d.adversaire
);
