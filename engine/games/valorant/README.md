# games/valorant

Vide pour l'instant.

Les règles de jeu spécifiques à Valorant (round, économie, sites de bombe,
capacités, résolution des duels, etc.) seront implémentées ici à l'étape 4
(règles Valorant), une fois les fondations du moteur (`core/`), le mapping
(`map/`) et l'IA (`ai/`) posés.

Ce module viendra se brancher sur le moteur générique via le bus d'événements
et le point d'extension `onTick` de `runSimulation`, sans modifier `core/`.
