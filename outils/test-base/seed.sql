-- Utilisateurs de test : Tony (admin), Will, Franck, Gérald (membres), Paul (en attente)
insert into auth.users (id, email, raw_user_meta_data) values
 ('11111111-1111-1111-1111-111111111111','tony@test.fr','{"first_name":"Tony","last_name":"Al Kassis","nickname":"Big Tonz"}'),
 ('22222222-2222-2222-2222-222222222222','will@test.fr','{"first_name":"Will","last_name":"Martin"}'),
 ('33333333-3333-3333-3333-333333333333','franck@test.fr','{"first_name":"Franck","last_name":"Petit"}'),
 ('44444444-4444-4444-4444-444444444444','gerald@test.fr','{"first_name":"Gérald","last_name":"Bernard"}'),
 ('55555555-5555-5555-5555-555555555555','paul@test.fr','{"first_name":"Paul","last_name":"Attente"}');
alter table public.profiles disable trigger user;
update public.profiles set status='active' where first_name <> 'Paul';
update public.profiles set role='admin', use_nickname=true where first_name='Tony';
alter table public.profiles enable trigger user;
