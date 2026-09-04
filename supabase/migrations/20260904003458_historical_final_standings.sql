-- ESPN final regular-season standings for league 1915525. 2020 is kept as an
-- empty season marker because ESPN reports every club at 0-0 with no points.
create table public.historical_standings (
  league_id uuid not null references public.leagues(id) on delete cascade,
  season integer not null check (season between 2000 and 2100),
  final_rank integer,
  team_name text,
  manager_names text,
  wins integer,
  losses integer,
  ties integer,
  points_for numeric,
  points_against numeric,
  moves integer,
  source text not null default 'ESPN',
  primary key (league_id, season, final_rank),
  constraint historical_standings_rank_check check (final_rank between 0 and 99)
);

comment on table public.historical_standings is
  'Final regular-season standings imported from ESPN. Rank 0 is an explicit season-with-no-results marker.';

alter table public.historical_standings enable row level security;
create policy historical_standings_members_read on public.historical_standings
  for select to authenticated using (public.ff_is_member());
revoke all on table public.historical_standings from public, anon;
grant select on table public.historical_standings to authenticated;

insert into public.historical_standings
  (league_id, season, final_rank, team_name, manager_names, wins, losses, ties, points_for, points_against, moves)
values
-- 2017
('11111111-1111-1111-1111-111111111111',2017,1,'Fournetteflix and Hill','Bradley Ehlers',11,2,0,1666.50,1349.68,35),
('11111111-1111-1111-1111-111111111111',2017,2,'Green Eggs and Cam','andy kros',10,3,0,1691.10,1458.06,17),
('11111111-1111-1111-1111-111111111111',2017,3,'Stairway to Evans','Mitch Groeschl',9,4,0,1441.24,1373.96,20),
('11111111-1111-1111-1111-111111111111',2017,4,'Twan gets No TDs','TYLER KOHTALA',8,5,0,1458.92,1463.40,21),
('11111111-1111-1111-1111-111111111111',2017,5,'Team Honzik','Jacob Tobin, Joshua Honzik',7,6,0,1489.50,1437.26,15),
('11111111-1111-1111-1111-111111111111',2017,6,'Forte Inch Johnson','tom ehlers',6,7,0,1497.88,1430.86,22),
('11111111-1111-1111-1111-111111111111',2017,7,'Team wineberg','joe wineberg',3,10,0,1285.28,1484.66,19),
('11111111-1111-1111-1111-111111111111',2017,8,'Jim McMahon','lori vandenbergh',5,8,0,1392.40,1386.76,38),
('11111111-1111-1111-1111-111111111111',2017,9,'Pen 15 Club','anthony haapalainen',5,8,0,1478.32,1472.72,10),
('11111111-1111-1111-1111-111111111111',2017,10,'Bottle Service','Mike Haapalainen',4,9,0,1317.56,1503.98,19),
('11111111-1111-1111-1111-111111111111',2017,11,'The Barry 20','Todd Haapalainen',6,7,0,1277.24,1422.40,36),
('11111111-1111-1111-1111-111111111111',2017,12,'Dakstreet Boys','camden eure, Jerrod McMonagle',4,9,0,1408.84,1621.04,14),
-- 2018
('11111111-1111-1111-1111-111111111111',2018,1,'Litty City','Mitch Groeschl',9,4,0,1636.76,1518.16,22),
('11111111-1111-1111-1111-111111111111',2018,2,'Strippers Row Pukes','Bradley Ehlers',9,4,0,1783.72,1574.98,25),
('11111111-1111-1111-1111-111111111111',2018,3,'Missy Elliott','Mikole Pierce',8,4,1,1707.02,1544.72,22),
('11111111-1111-1111-1111-111111111111',2018,4,'Gurleys gone wild','Jacob Tobin',9,4,0,1585.52,1549.56,14),
('11111111-1111-1111-1111-111111111111',2018,5,'The Barry 20','Todd Haapalainen',7,6,0,1639.96,1501.34,39),
('11111111-1111-1111-1111-111111111111',2018,6,'Green Eggs and Beckham','andy kros',7,6,0,1706.20,1609.28,16),
('11111111-1111-1111-1111-111111111111',2018,7,'Bottle Service','Mike Haapalainen',7,6,0,1518.42,1528.42,16),
('11111111-1111-1111-1111-111111111111',2018,8,'All Barkley, All Bite','camden eure',6,7,0,1576.64,1632.34,24),
('11111111-1111-1111-1111-111111111111',2018,9,'Hit The Twan','anthony haapalainen',3,10,0,1445.78,1600.60,12),
('11111111-1111-1111-1111-111111111111',2018,10,'Sookma Bulls','Jerrod McMonagle',5,8,0,1381.70,1460.22,6),
('11111111-1111-1111-1111-111111111111',2018,11,'TDs In The Face','TYLER KOHTALA',4,9,0,1526.38,1765.68,29),
('11111111-1111-1111-1111-111111111111',2018,12,'Forte Inch Johnson','Michael Barrett',3,9,1,1474.62,1697.42,13),
-- 2019
('11111111-1111-1111-1111-111111111111',2019,1,'Strippers Row Pukes','Bradley Ehlers',10,3,0,1774.80,1490.52,23),
('11111111-1111-1111-1111-111111111111',2019,2,'King of The North','camden eure',7,6,0,1541.76,1554.18,19),
('11111111-1111-1111-1111-111111111111',2019,3,'Bottle Service','Mike Haapalainen',7,6,0,1617.28,1530.84,30),
('11111111-1111-1111-1111-111111111111',2019,4,'Return of The Mack','Mike Pierce',7,6,0,1704.06,1603.96,18),
('11111111-1111-1111-1111-111111111111',2019,5,'TDs In The Face','TYLER KOHTALA',8,5,0,1575.74,1403.12,14),
('11111111-1111-1111-1111-111111111111',2019,6,'The Barry 20','Todd Haapalainen',8,5,0,1628.02,1492.80,66),
('11111111-1111-1111-1111-111111111111',2019,7,'Sage Heugel','sage heugel',6,7,0,1465.44,1458.08,27),
('11111111-1111-1111-1111-111111111111',2019,8,'Sookma Bulls','Jerrod McMonagle',5,8,0,1458.20,1624.38,10),
('11111111-1111-1111-1111-111111111111',2019,9,'Litty City','Mitch Groeschl',5,8,0,1441.02,1622.80,23),
('11111111-1111-1111-1111-111111111111',2019,10,'Hit The Twan','anthony haapalainen',7,6,0,1496.86,1471.26,9),
('11111111-1111-1111-1111-111111111111',2019,11,'Green Eggs and Cam','andy kros',3,10,0,1371.02,1721.88,14),
('11111111-1111-1111-1111-111111111111',2019,12,'GOOD JUJU','Jacob Tobin',5,8,0,1423.90,1524.28,13),
-- 2020: ESPN records no played games.
('11111111-1111-1111-1111-111111111111',2020,0,null,null,null,null,null,null,null,null),
-- 2021
('11111111-1111-1111-1111-111111111111',2021,1,'Litty City','Mitch Groeschl',11,3,0,1744.94,1651.84,32),
('11111111-1111-1111-1111-111111111111',2021,2,'Strippers Row Pukes','Bradley Ehlers',10,4,0,1705.18,1523.74,27),
('11111111-1111-1111-1111-111111111111',2021,3,'Bottle Service','Mike Haapalainen',7,7,0,1850.36,1736.52,15),
('11111111-1111-1111-1111-111111111111',2021,4,'The Barry 20','Todd Haapalainen',9,5,0,1569.04,1528.26,60),
('11111111-1111-1111-1111-111111111111',2021,5,'Catch 22','camden eure',8,6,0,1682.44,1612.14,13),
('11111111-1111-1111-1111-111111111111',2021,6,'Green Eggs and Cam','andy kros',9,5,0,1599.40,1628.00,13),
('11111111-1111-1111-1111-111111111111',2021,7,'GOOD JUJU','Jacob Tobin',4,10,0,1475.32,1536.38,17),
('11111111-1111-1111-1111-111111111111',2021,8,'JacksOn Jacks Off','TYLER KOHTALA',6,8,0,1624.92,1662.18,22),
('11111111-1111-1111-1111-111111111111',2021,9,'Morning Woods','Mike Pierce',4,10,0,1718.32,1841.76,20),
('11111111-1111-1111-1111-111111111111',2021,10,'Team Ehlers','tom ehlers',5,9,0,1647.98,1732.36,17),
('11111111-1111-1111-1111-111111111111',2021,11,'Sookma Bulls','Jerrod McMonagle',7,7,0,1567.88,1636.88,7),
('11111111-1111-1111-1111-111111111111',2021,12,'Hit The Twan','anthony haapalainen',4,10,0,1495.50,1591.22,9),
-- 2022
('11111111-1111-1111-1111-111111111111',2022,1,'Let''s Go Brandon','TYLER KOHTALA',11,3,0,1795.00,1538.22,13),
('11111111-1111-1111-1111-111111111111',2022,2,'Dookie Dookers','Josh Groeschl',9,5,0,1659.10,1552.34,21),
('11111111-1111-1111-1111-111111111111',2022,3,'Bottle Service','Mike Haapalainen',8,6,0,1516.82,1475.64,18),
('11111111-1111-1111-1111-111111111111',2022,4,'Natural born Kylers','Jacob Tobin',8,6,0,1660.54,1550.92,18),
('11111111-1111-1111-1111-111111111111',2022,5,'The Barry 20','Todd Haapalainen',7,7,0,1599.78,1620.64,79),
('11111111-1111-1111-1111-111111111111',2022,6,'Team Ehlers','Bradley Ehlers, tom ehlers',7,7,0,1607.40,1487.04,21),
('11111111-1111-1111-1111-111111111111',2022,7,'Litty City','Mitch Groeschl',7,7,0,1596.98,1595.30,27),
('11111111-1111-1111-1111-111111111111',2022,8,'Red Solo Kupp','camden eure',6,8,0,1725.00,1692.30,19),
('11111111-1111-1111-1111-111111111111',2022,9,'Peanut Butter Balls','Mike Pierce',6,8,0,1613.22,1590.86,21),
('11111111-1111-1111-1111-111111111111',2022,10,'Sookma Bulls','Jerrod McMonagle',4,10,0,1391.14,1662.86,9),
('11111111-1111-1111-1111-111111111111',2022,11,'Hit The Twan','anthony haapalainen',6,8,0,1536.16,1755.48,12),
('11111111-1111-1111-1111-111111111111',2022,12,'Kros Bros Company','andy kros, Connor Kros',5,9,0,1573.56,1753.10,8),
-- 2023
('11111111-1111-1111-1111-111111111111',2023,1,'''Merica','camden eure',8,6,0,1729.72,1598.64,22),
('11111111-1111-1111-1111-111111111111',2023,2,'MarlBurrow Smokes','Connor Kros, andy kros',9,5,0,1785.00,1651.42,10),
('11111111-1111-1111-1111-111111111111',2023,3,'Team Ehlers','Bradley Ehlers, tom ehlers',12,2,0,1711.54,1390.42,13),
('11111111-1111-1111-1111-111111111111',2023,4,'Litty City','Mitch Groeschl',9,5,0,1735.92,1541.54,27),
('11111111-1111-1111-1111-111111111111',2023,5,'Dookie Dookers','Josh Groeschl',8,6,0,1749.84,1596.24,6),
('11111111-1111-1111-1111-111111111111',2023,6,'Hit The Twan','anthony haapalainen',7,7,0,1662.70,1688.88,5),
('11111111-1111-1111-1111-111111111111',2023,7,'Carolina Panthers','Todd Haapalainen',4,10,0,1590.34,1685.08,38),
('11111111-1111-1111-1111-111111111111',2023,8,'Sookma Bulls','Jerrod McMonagle',3,11,0,1400.62,1747.64,12),
('11111111-1111-1111-1111-111111111111',2023,9,'Bottle Service','Mike Haapalainen',6,8,0,1560.34,1730.82,14),
('11111111-1111-1111-1111-111111111111',2023,10,'Let''s Go Brandon','TYLER KOHTALA',7,7,0,1516.94,1499.82,11),
('11111111-1111-1111-1111-111111111111',2023,11,'Cooper Troopers','Jacob Tobin, Jeff Feller',4,10,0,1402.04,1631.68,9),
('11111111-1111-1111-1111-111111111111',2023,12,'TBD','Mikole Pierce',7,7,0,1603.74,1686.56,18),
-- 2024
('11111111-1111-1111-1111-111111111111',2024,1,'Let''s Go Brandon','TYLER KOHTALA',12,2,0,1844.78,1521.26,10),
('11111111-1111-1111-1111-111111111111',2024,2,'Sookma Bulls','Jerrod McMonagle',11,3,0,1766.68,1603.74,16),
('11111111-1111-1111-1111-111111111111',2024,3,'Team Ehlers','Bradley Ehlers, tom ehlers',8,6,0,1695.22,1605.56,19),
('11111111-1111-1111-1111-111111111111',2024,4,'''Merica','camden eure',7,7,0,1601.02,1633.02,18),
('11111111-1111-1111-1111-111111111111',2024,5,'TBD','Mikole Pierce',6,8,0,1682.88,1735.58,22),
('11111111-1111-1111-1111-111111111111',2024,6,'Roger Brown','Todd Haapalainen',7,7,0,1523.14,1557.08,60),
('11111111-1111-1111-1111-111111111111',2024,7,'To Infinity and De''Von','Jacob Tobin, Jeff Feller',4,10,0,1544.96,1837.46,11),
('11111111-1111-1111-1111-111111111111',2024,8,'Mac and Chase','Connor Kros, andy kros',6,8,0,1650.16,1586.42,10),
('11111111-1111-1111-1111-111111111111',2024,9,'Dookie Dookers','Josh Groeschl',6,8,0,1609.20,1629.36,9),
('11111111-1111-1111-1111-111111111111',2024,10,'Hit The Twan','anthony haapalainen',5,9,0,1466.82,1562.00,9),
('11111111-1111-1111-1111-111111111111',2024,11,'Bottle Service','Mike Haapalainen',6,8,0,1455.70,1496.16,11),
('11111111-1111-1111-1111-111111111111',2024,12,'Litty City','Mitch Groeschl',6,8,0,1657.62,1730.54,30),
-- 2025
('11111111-1111-1111-1111-111111111111',2025,1,'''Merica','camden eure',9,5,0,1849.42,1615.14,16),
('11111111-1111-1111-1111-111111111111',2025,2,'Roger Brown','Todd Haapalainen',8,6,0,1589.04,1601.24,59),
('11111111-1111-1111-1111-111111111111',2025,3,'Let''s Go Brandon','TYLER KOHTALA',7,7,0,1646.56,1563.26,14),
('11111111-1111-1111-1111-111111111111',2025,4,'To Infinity and De''Von','Jacob Tobin, Jeff Feller',10,4,0,1733.20,1588.88,9),
('11111111-1111-1111-1111-111111111111',2025,5,'Team Ehlers','Bradley Ehlers, tom ehlers',8,6,0,1521.58,1515.38,19),
('11111111-1111-1111-1111-111111111111',2025,6,'Mac and Chase','Connor Kros, andy kros',9,5,0,1842.80,1560.74,5),
('11111111-1111-1111-1111-111111111111',2025,7,'Bottle Service','Mike Haapalainen',6,8,0,1629.00,1656.06,10),
('11111111-1111-1111-1111-111111111111',2025,8,'Sookma Bulls','Jerrod McMonagle',3,11,0,1425.56,1668.50,8),
('11111111-1111-1111-1111-111111111111',2025,9,'Dookie Dookers','Josh Groeschl',5,9,0,1373.58,1521.48,15),
('11111111-1111-1111-1111-111111111111',2025,10,'TBD','Mikole Pierce',7,7,0,1629.06,1630.96,14),
('11111111-1111-1111-1111-111111111111',2025,11,'Litty City','Mitch Groeschl',5,9,0,1470.70,1622.16,12),
('11111111-1111-1111-1111-111111111111',2025,12,'Hit The Twan','anthony haapalainen',7,7,0,1397.84,1564.54,11);
