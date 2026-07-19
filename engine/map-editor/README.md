# Map Editor

Outil autonome (Vite + React + Tailwind + TypeScript) pour créer et éditer des
fichiers de carte au format `MapData` du moteur de simulation, à partir d'une
image `.webp`. Distribué séparément du jeu principal (zip / build statique) :
ce dossier ne dépend d'aucun autre module de `engine/` à l'exécution, à
l'exception des types partagés (`engine/types/map.ts`) et de la validation
(`engine/map/mapValidator.ts`), importés directement en TypeScript (aucune
logique dupliquée).

Ne contient **aucune** logique de simulation, d'IA ou de pathfinding — il ne
fait que produire des fichiers `MapData` corrects.

## Lancer en local

```bash
cd engine/map-editor
npm install
npm run dev
```

Puis ouvrir l'URL affichée (`http://localhost:5173` par défaut).

Autres commandes :

```bash
npm run build      # build statique de production (dossier dist/)
npm run preview    # sert le build de production en local
npm run typecheck  # vérification TypeScript sans build
```

## Fonctionnalités

- **Import d'image** : charge un `.webp` en fond de carte, récupère
  automatiquement `width`/`height` depuis les dimensions réelles du fichier.
- **Zones** (mode "Zone") : dessin de polygone au clic, validation par Entrée
  ou double-clic. Nom libre + type (`site`/`spawn`/`corridor`/`open_area`).
- **Murs** (mode "Mur") : même logique de dessin, rendu distinct en rouge
  (bloquent déplacement ET tir).
- **Caisses** (mode "Caisse") : placement au clic avec taille
  `small`/`medium`/`large` choisie au préalable ; légende visible rappelant
  les règles de blocage de chaque taille.
- **Sélection/édition** : en mode "Sélection", cliquer une forme la
  sélectionne (panneau de propriétés à droite) ; glisser la forme la déplace,
  glisser un point (petit cercle) déforme le polygone. Suppr/Retour arrière
  supprime l'élément sélectionné.
- **Calques** : panneau à gauche pour afficher/masquer indépendamment image,
  zones, murs, caisses (masquer un calque le rend aussi non cliquable).
- **Zoom/pan** : molette pour zoomer (centré sur le curseur), Espace + glisser
  ou clic molette pour se déplacer sur le canvas.
- **Export** : bouton "Exporter JSON" — construit le `MapData`, le valide
  avec `validateMapData` (partagé avec le reste du moteur), puis télécharge
  le fichier si valide (sinon affiche les erreurs).
- **Import** : bouton "Importer JSON" — recharge un `MapData` existant
  (zones/murs/caisses/dimensions) pour continuer à l'éditer. L'image de fond
  n'étant pas embarquée dans le JSON (seul son nom de fichier l'est), il faut
  la resélectionner via "Charger l'image" après un import.

## Roadmap du moteur

Cet éditeur correspond à l'étape 2 de `engine/README.md` (mapping). Voir ce
fichier pour la suite (IA, règles Valorant, intégration).
