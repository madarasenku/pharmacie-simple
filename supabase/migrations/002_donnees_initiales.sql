-- Pharmacie Simple — données de départ
-- Programmes, réglages et liste des produits recouvrables (formulaire du district).
-- Les prix viennent des fiches papier et restent modifiables dans l'onglet Base.

insert into public.programmes (code, nom, sigle, est_vente, frequence, categories, ordre) values
  ('VENTE', 'Vente (produits recouvrables)', 'VENTE', true, 'mensuel', '{}', 0),
  ('PNLP', 'Paludisme', 'PNLP', false, 'mensuel', '{"Enfant < 5 ans","Femme enceinte","Adulte"}', 10),
  ('GRAT', 'Gratuité ciblée', 'GRAT', false, 'mensuel', '{"Enfant < 5 ans","Femme enceinte"}', 20),
  ('PF', 'Planification familiale', 'PF', false, 'trimestriel', '{"Femme","Homme"}', 30);

insert into public.parametres (cle, valeur) values
  ('droits_vendeur', '{"vendre": true, "entree": true, "credit": true, "programmes": true, "corriger": false, "annuler": false, "prix": false, "rapports": false, "base": false}'),
  ('pharmacie', '{"nom": "[NOM DE LA PHARMACIE]", "region": "SUD COMOÉ", "district": "GRAND-BASSAM", "etablissement": "[NOM DE L''ÉTABLISSEMENT]", "telephone": "", "adresse": ""}');

-- Produits recouvrables (prix unitaire du district = prix d'achat ; prix de vente identique par défaut)
insert into public.produits (designation, prix_achat, prix_vente) values
  ('ACIDE FOLIQUE 5 MG COMP', 13, 13),
  ('ALBENDAZOLE 400 MG SP', 500, 500),
  ('ALBENDAZOLE 400 MG CP', 100, 100),
  ('AMOXI + ACIDE CLAVULANIQUE 100/12,5 mg/ml pdre susp. buv fl/60 ml', 1800, 1800),
  ('AMOXI + ACIDE CLAVULANIQUE 250/31,25 mg/ml pdre susp. buv fl/60 ml', 1800, 1800),
  ('AMOXI + ACIDE CLAVULANIQUE 500/62,5 mg comp. bte/16', 2200, 2200),
  ('AMOXICILLINE 250 mg/5 ml pdre susp. buv fl/60 ml', 600, 600),
  ('AMOXICILLINE 500 mg GÉLULE', 60, 60),
  ('AMPICILLINE 1 g pdre sol. inj.', 400, 400),
  ('HYDROXYDE DE MAGNÉSIUM SACHET (anti-acide)', 150, 150),
  ('BANDE DE CRÊPE 4 x 0,10 m ROULEAU', 500, 500),
  ('BÉTAMÉTHASONE 4 MG AMP INJ', 350, 350),
  ('BÉTADINE JAUNE 10 % fl/125 ml', 1000, 1000),
  ('BÉTADINE JAUNE 10 % fl/200 ml', 1500, 1500),
  ('BÉTADINE JAUNE 10 % fl/500 ml', 3500, 3500),
  ('CAPTOPRIL 25 MG COMP', 20, 20),
  ('CAPTOPRIL 50 MG COMP', 25, 25),
  ('CARBOCISTÉINE 2 % SIROP (100 mg/5 ml) fl/100 ml', 750, 750),
  ('CARBOCISTÉINE 5 % (750 mg/15 ml) sol. buv fl/100 ml', 850, 850),
  ('CEFIXIME 100 MG/5 ML SUSP.', 1700, 1700),
  ('CEFIXIME 200 MG COMP bte/10', 2300, 2300),
  ('CEFTRIAXONE 1 G AMPOULE INJ.', 1200, 1200),
  ('CEFTRIAXONE 250 MG AMPOULE INJ.', 400, 400),
  ('CIPROFLOXACINE 500 MG CP', 46, 46),
  ('COMPRESSES DE GAZE NON STÉRILES 40 x 40 paquet/100', 3500, 3500),
  ('COMPRESSES STÉRILES', 350, 350),
  ('COTON HYDROPHILE ROULEAU 1 KG', 3300, 3300),
  ('COTON HYDROPHILE ROULEAU 500 G', 2100, 2100),
  ('DESLORATADINE SIROP', 3000, 3000),
  ('DEXAMÉTHASONE 4 mg/ml amp. inj.', 200, 200),
  ('DIAZÉPAM 10 mg/2 ml amp. inj.', 250, 250),
  ('DICLOFÉNAC 100 MG SUPPOSITOIRE', 85, 85),
  ('DICLOFÉNAC 50 MG COMP', 30, 30),
  ('DICLOFÉNAC 75 mg/3 ml amp. inj.', 235, 235),
  ('DIOSMECTITE 3 G SACHET', 150, 150),
  ('DOXYCYCLINE 100 MG COMP', 35, 35),
  ('DOXYCYCLINE 200 MG COMP', 110, 110),
  ('ÉCONAZOLE 150 mg OVULE', 450, 450),
  ('ÉRYTHROMYCINE 250 MG CP', 46, 46),
  ('ÉRYTHROMYCINE 500 MG CP', 75, 75),
  ('ÉRYTHROMYCINE SP', 1000, 1000),
  ('EXACYL (ACIDE TRANEXAMIQUE) 500 mg/5 ml amp. inj.', 500, 500),
  ('FER III + ACIDE FOLIQUE (OROFER) CAPSULE bte/40', 1800, 1800),
  ('FER SIROP POLYMALT 100 ml', 850, 850),
  ('FER SIROP OROFER 150 ml', 900, 900),
  ('FER SIROP XFERON 200 ml', 1200, 1200),
  ('FER SIROP YEKAFER 200 ml', 1100, 1100),
  ('FIL NON RÉSORBABLE 2/0', 1100, 1100),
  ('FIL RÉSORBABLE 2/0', 800, 800),
  ('GÉLATINE 500 ML solution inj.', 1500, 1500),
  ('GENTAMICINE COLLYRE 0,3 % fl/5 ml', 3000, 3000),
  ('GLUCONATE DE CALCIUM INJ 10 % amp. inj.', 400, 400),
  ('HYDROSOL POLYVITAMINÉ amp/2 ml inj (HPV)', 300, 300),
  ('INTRANULE COURT 18G', 380, 380),
  ('INTRANULE COURT 20G', 250, 250),
  ('INTRANULE COURT 22G', 300, 300),
  ('INTRANULE COURT 24G', 250, 250),
  ('LAME DE BISTOURI N°23', 75, 75),
  ('LEUKOPLAST ROULEAU', 3500, 3500),
  ('LIDOCAÏNE 2 % inj. 20 mg/ml', 1000, 1000),
  ('LIDOCAÏNE 2 % inj. 10 mg/ml', 400, 400),
  ('LOPÉRAMIDE 2 mg GÉLULE', 23, 23),
  ('MAGNÉSIUM SULFATE 10 % amp. inj.', 600, 600),
  ('MAGNÉSIUM SULFATE 15 % amp. inj.', 300, 300),
  ('MÉTOPIMAZINE 10 mg/ml amp. inj.', 300, 300),
  ('MÉTOPIMAZINE 5 mg SUPPOSITOIRE', 100, 100),
  ('MÉTRONIDAZOLE 125 mg/ml susp.', 900, 900),
  ('MÉTRONIDAZOLE 500 MG CP', 40, 40),
  ('MÉTRONIDAZOLE 500 mg sol. inj.', 600, 600),
  ('MÉTRONIDAZOLE OVULE', 200, 200),
  ('OFLOXACINE 200 MG CP bte/10', 1000, 1000),
  ('OMÉPRAZOLE 20 MG GÉLULE bte/14', 1200, 1200),
  ('PARACÉTAMOL 125 mg/5 ml susp. buv. fl/100 ml', 800, 800),
  ('PARACÉTAMOL 500 MG COMP', 10, 10),
  ('PARACÉTAMOL + CODÉINE 400 mg/20 mg CP', 40, 40),
  ('PERFUSEUR ADULTE', 300, 300),
  ('PHLOROGLUCINOL 150 mg SUPPOSITOIRE', 200, 200),
  ('PHLOROGLUCINOL 40 mg/4 ml amp. inj.', 550, 550),
  ('PHLOROGLUCINOL 80 MG COMP bte/20', 1000, 1000),
  ('POTASSIUM CHLORURE 10 % AMPOULE INJ', 215, 215),
  ('PYRANTEL PAMOATE SP', 600, 600),
  ('RESTRIVA 500 mg/5 ml AMP INJ (pédiatrique)', 200, 200),
  ('RESTRIVA 500 mg/ml AMP INJ (2,5 g inj.)', 500, 500),
  ('RETARPEN 2,4 INJ', 400, 400),
  ('RINGER LACTATE 500 ml', 800, 800),
  ('SAT INJ', 2000, 2000),
  ('SERINGUE 10 CC', 80, 80),
  ('SERINGUE 5 CC', 80, 80),
  ('SÉRUM GLUCOSÉ 5 % 250 ml sol. inj.', 600, 600),
  ('SÉRUM GLUCOSÉ 5 % 500 ml sol. inj.', 800, 800),
  ('SÉRUM GLUCOSÉ 10 % 500 ml sol. inj.', 800, 800),
  ('SÉRUM SALÉ 0,9 % 250 ml sol. inj.', 600, 600),
  ('SÉRUM SALÉ 0,9 % 500 ml sol. inj.', 800, 800),
  ('TERPINE CODÉINE 40 mg COMP', 40, 40),
  ('TRAMADOL GÉLULE boîte/30', 1800, 1800),
  ('TRAMADOL GÉLULE plaquette/10', 600, 600),
  ('TRAMADOL INJECTABLE 100 mg/2 ml', 450, 450),
  ('TRIMÉBUTINE COMP', 135, 135),
  ('TRIMÉBUTINE SIROP', 2500, 2500),
  -- Ajoutés à la main sur la fiche : prix à compléter
  ('AZITHROMYCINE 500 MG CP', 0, 0),
  ('GRISÉOFULVINE 250 MG CP', 0, 0),
  ('MÉTRONIDAZOLE 250 MG CP', 0, 0),
  ('SALBUTAMOL AMP INJ', 0, 0),
  ('TIÉMONIUM 10 MG', 0, 0),
  ('LAME DE BISTOURI N°15', 0, 0);

-- Tous ces produits sont vendus
insert into public.produits_programmes (produit_id, programme_id)
select p.id, g.id from public.produits p cross join public.programmes g where g.code = 'VENTE';

-- Produits des programmes (gratuits)
insert into public.produits (designation, presentation) values
  ('ACT nourrisson (2-11 mois)', 'Plaquette'),
  ('ACT enfant (1-5 ans)', 'Plaquette'),
  ('ACT adulte', 'Plaquette'),
  ('TDR paludisme', 'Test'),
  ('SP (TPI femme enceinte)', 'Comprimé'),
  ('SRO + Zinc', 'Kit'),
  ('Contraceptif oral', 'Plaquette'),
  ('Contraceptif injectable', 'Dose'),
  ('Préservatifs', 'Boîte');

insert into public.produits_programmes (produit_id, programme_id)
select p.id, g.id from public.produits p join public.programmes g on (
  (g.code = 'PNLP' and p.designation in ('ACT nourrisson (2-11 mois)', 'ACT enfant (1-5 ans)', 'ACT adulte', 'TDR paludisme', 'SP (TPI femme enceinte)'))
  or (g.code = 'GRAT' and p.designation in ('ACT nourrisson (2-11 mois)', 'ACT enfant (1-5 ans)', 'TDR paludisme', 'SRO + Zinc',
                                            'PARACÉTAMOL 125 mg/5 ml susp. buv. fl/100 ml', 'AMOXICILLINE 250 mg/5 ml pdre susp. buv fl/60 ml',
                                            'FER III + ACIDE FOLIQUE (OROFER) CAPSULE bte/40'))
  or (g.code = 'PF' and p.designation in ('Contraceptif oral', 'Contraceptif injectable', 'Préservatifs'))
);
