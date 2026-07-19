# ai

Vide pour l'instant.

L'intelligence artificielle des bots (prise de décision, pathfinding sur la
`navGrid` de `MapData`, visée, réaction aux événements de jeu) sera
implémentée ici à l'étape 3 (IA), après le mapping (étape 2) et avant les
règles Valorant (étape 4).

Comme pour `games/valorant`, ce module se branchera sur le moteur via le bus
d'événements et le point d'extension `onTick`, sans coupler `core/` à une
implémentation d'IA précise.
