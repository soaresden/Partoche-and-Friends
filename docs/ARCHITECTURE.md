# Architecture

## Règle d'or

**Chacun n'écrit que chez soi, tout le monde lit tout le monde.**
Il n'y a donc jamais de conflit d'écriture : l'état du collectif est la *fusion* de ce que chaque membre publie.

| | Partoche | WeMeetMusik | Partoche and Friends |
|---|---|---|---|
| Stockage | pCloud de l'élève | MEGA (un compte commun) | pCloud de **chaque** membre |
| Serveur | aucun | Replit (proxy MEGA) + Supabase | aucun |
| Qui écrit où | élève chez lui, prof par lien de dépôt | tout le monde dans le même MEGA | chacun chez soi |
| Temps réel | ntfy.sh | — | ntfy.sh, chiffré |
| Utilisateurs | 1 élève ⇄ 1 prof | table Supabase | membres découverts par invitation + bouche-à-oreille |

## Mon espace (`web/js/cloud.js`)

Dossier : celui de Partoche (choisi parmi les dossiers partagés par lien, `listpublinks`) ; partitions lues dans `MSCZ/`, écriture uniquement dans `Friends/` (`!Moi.json`, `Notes/`). Les annotations avec la prof (`MesNotes/`, `Prof/`) restent un calque séparé.

Connexion pCloud par OAuth « implicit » (`my.pcloud.com/oauth2/authorize?response_type=token`) : le jeton revient dans l'URL (`#access_token=…&hostname=…`) et reste dans le navigateur.
Appels utilisés : `createfolderifnotexists`, `listfolder` (récursif), `uploadfile` (écrase le fichier du même nom), `gettextfile`, `getzip` (les serveurs de fichiers pCloud n'autorisent pas le CORS, l'API oui — même astuce que Partoche), `deletefile`, `listpublinks` / `getfolderpublink` / `changepublink`, `userinfo`.

Mode démo : même interface, stockée dans IndexedDB.

## Les amis (`web/js/library.js` → `Peer`)

Lecture seule par le lien public : `showpublink` (arborescence), `getpubtextfile` (JSON), `getpubzip` (`.mscz`). C'est `PublicFolder` de Partoche, inchangé.

## `!Moi.json`

```jsonc
{
  "v": 1,
  "group": { "id": "f_lugkAY", "name": "Les copains du jeudi", "key": "<clé 128 bits>" },
  "me":    { "id": "…", "name": "Ami·e 1", "emoji": "🎻", "color": "#3e8ed0", "instruments": "violon",
             "link": "https://e.pcloud.link/publink/show?code=…", "pw": "…" },
  "knows": [ { "id": "…", "name": "Ami·e 2", "emoji": "🎹", "color": "#d04e8e", "link": "…", "pw": "…" } ],
  "scores":   { "ode.mscz": { "title": "Ode à la joie", "composer": "Beethoven", "basedOn": "", "addedAt": 1759690000000 } },
  "work":     { "<idPartition>": { "status": "encours", "part": "Violon 1", "at": 1759690000000 } },
  "comments": [ { "score": "<idPartition>", "at": 1759690000000, "text": "On le joue jeudi ?" } ],
  "updated": 1759690000000
}
```

- **id d'une partition** = `<id du membre qui l'a>/<nom du fichier>` (ex. `Xy12…/ode.mscz`).
- **Morceau** = partitions regroupées par titre normalisé, en suivant `basedOn` jusqu'à l'original. Statut, partie et commentaires sont rattachés à l'original ; la fiche du morceau fusionne ceux de toutes ses versions.
- `group.key` est dans le dossier de chacun (les membres l'ont déjà) : en reconnectant son pCloud sur un autre appareil, on retrouve tout sans nouvelle invitation.

## Annotations : `Friends/Notes/<id avec / → ~>.json`

```json
{ "v": 1, "score": "<idPartition>", "by": "<moi>", "updated": 0, "pages": [ [ /* objets Ink de Partoche */ ] ] }
```

Les objets sont ceux d'`ink.js` (coordonnées normalisées par page). Le lecteur affiche les miens (modifiables) + un calque en lecture seule par ami (`Ink.setLayers`).
Limite connue : le rendu utilise toutes les parties visibles par défaut ; si deux membres ont des versions différentes, chacun annote **sa** version (l'id inclut le propriétaire), donc pas de décalage.

## Collectif, invitation et relais (`web/js/group.js`)

- **Invitation (un seul lien par collectif)** : `…/#rejoindre=F1.<base64url(deflate({ g: group, m: [cartes des membres] }))>`. Le même lien sert à tout le monde ; il survit au détour par pCloud (gardé en localStorage pendant l'OAuth).
- **Appareil de plus** : `…/#appareil=<sel>.<iv>.<AES-GCM(PBKDF2(code 6 chiffres), { pcloud: jeton, exp })>`, montré en QR code. L'appareil retrouve ensuite profil et collectif dans `!Moi.json`.
- **Bouche-à-oreille** : à chaque actualisation, on lit les `knows` des amis et on ajoute les inconnus (3 tours max). Personne n'a besoin d'être en ligne en même temps.
- **Relais ntfy.sh** : sujet `maf-<sha256(clé) tronqué>`, messages `AES-GCM(clé, { ev, from, score })` :
  - `hello` toutes les 75 s (présence, et la carte du membre → les nouveaux sont découverts tout de suite) ; `bye` à la fermeture ;
  - `index` : mon `!Moi.json` a changé → les autres relisent mon dossier ;
  - `ink` + `score` : mes annotations ont changé → ceux qui ont la partition ouverte rechargent mon calque.

## Feuille de route

**Fait (v0.1)** : connexion pCloud, collectif + invitation, bibliothèque fusionnée, versions, chantiers (statut + partie), discussion, annotations multi-calques, lecture audio, présence, mode démo.

À faire, par ordre d'intérêt :
1. **Tester en vrai** la connexion pCloud web (Client ID à créer) : `uploadfile` / `gettextfile` / `getzip` avec `access_token` depuis le navigateur (CORS), comptes EU et US.
2. **Lecteur complet de Partoche** : pistes (afficher / muet / solo), vitesse, boucle, curseur, noms des notes, mises en page — idéalement en extrayant le lecteur de Partoche dans un module commun aux deux projets.
3. **Appli Android** : reprendre la coquille WebView de Partoche (`MainActivity.java`, `PCloud.java`) pour la tablette + notifications.
4. **Répétitions** : un agenda commun (comme l'agenda de Partoche, version N membres) et des **setlists**.
5. **Étiquettes** perso par morceau (🔥 L'enfer, 😎 Easy…) et tags partagés.
6. **Enregistrements** : déposer un audio de sa partie dans `Audio/` pour que les autres jouent par-dessus.
7. **Exclure un membre** : nouvelle clé de collectif + nouvelle invitation aux autres (le partant garde ce qu'il a déjà lu).
8. Cache hors-ligne (service worker) et PWA installable.
