# wt — guide pour Claude

Gestionnaire de worktrees git intégré à [herdr](https://herdr.dev), le gestionnaire
de workspaces terminal. `wt` crée le worktree, le provisionne, et ouvre un space
herdr avec un layout de panes décrit par un DSL.

Il remplace un POC zsh de 110 lignes (`~/dotfiles/config/bin/bin/wt`) dont les bugs
sont listés dans le plan d'implémentation. Ne pas les réintroduire.

**Cible utilisateur : le développeur lui-même, et des agents.** Pas de public
non-technique. Tout est en **anglais**, code et UI — c'est la seule divergence
assumée avec chiro-tools, dont la cible est une naturaliste francophone.

## Stack figée

- **Bun** runtime + `bun --compile` pour les binaires (macOS arm64 + Linux x64)
- **mise** pour la toolchain (`mise.toml`), y compris en CI via `jdx/mise-action`
- **pnpm** 12 (lockfile committé), aligné avec `packageManager` dans `package.json`
- **TypeScript strict** (NodeNext, `noUncheckedIndexedAccess`, `target: ES2022`)
- **Ink 6** + **React 19**, **vitest 4** + `ink-testing-library`
- **smol-toml** — seule dépendance hors stack de base. Bun parse le TOML nativement
  à l'import, mais ça ne couvre ni un chemin résolu à l'exécution dans un binaire
  compilé, ni l'**écriture**, dont la génération de `.wt/*.toml` a besoin.

Pas de zod, pas de commander, pas de lib de parsing d'arguments. Le parseur CLI est
maison (~150 lignes pures) : c'est ce qui permet de **rejeter toute option inconnue**
avec exit 2, là où `zparseopts` laissait le POC créer une branche nommée `--help`.

## Architecture — règles dures

```
src/
  index.tsx       le SEUL endroit qui lit process.cwd() / process.env
  cli/            parse → ADT, help, codes de sortie, dispatch
  commands/       orchestration : séquence des appels lib/, retourne un Result
  lib/            métier ; jamais d'ink, jamais de react
    exec/         le SEUL endroit qui importe node:child_process
  format/         présentation pure ; node:path autorisé, rien d'autre en node:
  ui/             le seul endroit avec ink/react
```

| Couche      | Peut importer        | Ne peut pas                               |
| ----------- | -------------------- | ----------------------------------------- |
| `lib/`      | `lib/`, `node:*`     | ink, react, `ui/`, `format/`, `commands/` |
| `lib/exec/` | `node:child_process` | ink, react, `ui/`                         |
| `commands/` | `lib/`, `format/`    | ink, react, `ui/`, spawn direct           |
| `format/`   | `node:path`          | tout autre `node:*`, ink, react           |
| `ui/`       | tout                 | spawn direct                              |

**Un exec, un socket.** Tout sous-processus passe par `lib/exec/run.ts` :
`{argv, cwd, env, timeout, signal} → Result`. C'est ce qui fait exister le scrub
d'environnement, les timeouts et le kill de groupe **une fois**. La formulation
« deux points de contact avec l'extérieur » est un piège : chiro-tools a sept
imports `node:child_process` dispersés et aucun exec central.

**`commands/*` ne formate jamais et ne touche jamais ink.** Une commande _rend_ un
plan plutôt que de l'exécuter, ce qui donne `--dry-run` gratuitement.

### Les frontières sont testées, pas seulement déclarées

`src/lib/boundaries.test.ts` prouve chaque règle contre un vrai fichier sur disque.
Deux façons dont ces garde-fous deviennent inertes, les deux déjà rencontrées ici :

1. **`no-restricted-imports` matche la chaîne d'import, pas le chemin résolu.**
   Lister `"**/ui/**"` seul laisse passer `../ui/App.js`. Il faut lister les formes
   relatives aussi. chiro-tools a livré exactement cette régression.
2. **En flat config, un bloc qui redéfinit une règle la REMPLACE** pour les fichiers
   qu'il matche, il ne fusionne pas. Un deuxième bloc posant `no-restricted-imports`
   sur `src/lib/**` a supprimé en silence le ban de `node:child_process` dans tout
   `lib/`. Les blocs de `eslint.config.js` sont donc **disjoints** : exactement un
   bloc pose `no-restricted-imports` pour un fichier donné, et il énonce la totalité
   de ses restrictions.

Ajouter une frontière ⇒ ajouter sa sonde dans `boundaries.test.ts`, dans les deux
sens (elle mord là où il faut, elle ne mord pas sur l'exception).

## Conventions

- **Pas de `throw`** sur les chemins normaux : `Result` tagué
  (`{ kind: "ok", ... } | { kind: "error", code }`). Un exit code non nul n'est pas
  une erreur — `git check-ignore` qui renvoie 1 est une réponse.
- `AbortSignal` propagé dans tout I/O async ; `cancelled = false` dans les `useEffect`.
- Écriture de fichier atomique (`.tmp` + rename), toujours.
- Imports en `.js` (NodeNext). Pas d'`any`, pas de `!`.
- **Jamais de message d'erreur classé par sous-chaîne** sans `LC_ALL=C` garanti en
  amont : git répond en français sur cette machine. Classer par code de sortie et
  par sortie `--porcelain` quand elle existe.
- Tout chemin qui entre ou sort passe par `realpath` : sur macOS `/tmp` est
  `/private/tmp`, et deux clés non normalisées divergent en silence. Les fixtures de
  test normalisent leur racine pour la même raison.

## Pièges git mesurés sur cette machine

- **`GIT_DIR` hérité gagne sur `-C`.** `GIT_DIR=/a/.git git -C /b worktree list` opère
  sur `/a`, renvoie 0, ne dit rien. Les hooks, `git rebase -x` et `git bisect run`
  l'exportent. D'où le scrub dans `lib/exec/env.ts`, et `wt doctor` qui le signale.
- **Dans un sous-module, `git worktree list --porcelain` renvoie le GITDIR**
  (`<super>/.git/modules/sub`) comme chemin de worktree, pas le working tree.
  `rev-parse --show-toplevel` donne le bon. Faire confiance à la première sortie
  placerait `worktreesRoot` **dans** `.git`. Traité dans `topology.ts`.
- **Ne jamais dériver le checkout principal par `dirname(--git-common-dir)`** : pour un
  worktree de dépôt bare ça donne le dossier parent du bare, pour un sous-module
  `<super>/.git/modules`. La première entrée de `worktree list --porcelain` fait foi.
- **Un dépôt bare fait planter `rev-parse --show-toplevel`.** Tester
  `--is-bare-repository` d'abord et refuser franchement.
- **`check-ignore` renvoie 128 hors dépôt**, pas 1. Tester `!== 0` lit « non ignoré »
  dans « pas un dépôt ».

## Décisions câblées, pas seulement déclarées

Un champ de config accepté puis ignoré est une panne silencieuse. Le schéma ne
déclare donc **que** ce qui est lu : `repo.default_base`, `repo.remote`,
`space.label`, `space.layout`, `provision.{copy,timeout_ms,commands}`,
`remove.delete_branch`. Toute autre clé produit un warning et apparaît dans
`wt doctor`. Ajouter un champ ⇒ l'utiliser dans le même diff, ou ne pas l'ajouter.

**Le verdict umbrella est toujours tranché.** Il n'y a pas d'état `ask` : quand
aucune règle ne décide, `wt new` et `wt config` posent la question sur un vrai
terminal via `context.confirm`, et la réponse est mémorisée en créant `.wt/` du
côté choisi — le même marqueur que `declared-parent` / `declared-repo` relisent.
Sans terminal (`--json`, `--yes`, pipe), le verdict est `plain` avec la raison
`undecided`, que `wt doctor` affiche. `context.confirm` est absent hors TTY, donc
« personne à qui demander » vaut toujours « non ».

## Ink — mesuré sur ink 6.6

- **`instance.waitUntilExit()` ne résout jamais après `instance.unmount()`.**
  L'attendre bloque l'appelant pour toujours : l'écran répondu reste affiché et
  la commande ne reprend pas. Symptôme vu en vrai : « entrée n'a rien fait ».
  `unmount()` seul rend la main en quelques millisecondes.
- **Ink monte seulement le temps d'une question.** stdout appartient à Ink ou à
  l'appelant, jamais aux deux : `prompt()` démonte avant que quoi que ce soit
  soit écrit, dans un `finally`.
- **`patchConsole` est actif par défaut** : un `console.log` pendant qu'Ink
  dessine part dans son tampon et n'apparaît pas où on l'attend. Déboguer par
  `process.stderr.write`, ou couper `patchConsole`.
- **Un faux `stdin` fait maison ne suffit pas** pour éprouver `useInput` :
  utiliser le harnais d'`ink-testing-library`, qui alimente Ink correctement.
  Un faux naïf fait croire que `key.return` ne se déclenche pas.
- Pendant qu'Ink est monté, il possède aussi Ctrl-C : le handler de processus
  se tait, sinon « stopping… » s'écrit en plein milieu de la frame.

## Codes de sortie

|     |                                                                           |
| --- | ------------------------------------------------------------------------- |
| `0` | succès                                                                    |
| `1` | erreur                                                                    |
| `2` | erreur de syntaxe CLI (aligné sur herdr)                                  |
| `3` | succès partiel — le worktree existe, le provisioning ou le space a échoué |

Le 3 existe pour les agents : il dit « c'est créé mais pas prêt ».

## Commandes

```bash
pnpm dev              # lance la CLI
pnpm check            # lint + typecheck + format:check + test — doit être vert
pnpm test:watch
pnpm build            # binaires darwin-arm64 + linux-x64
```

## Workflow attendu

1. **Toute tâche non triviale** passe par le mode plan. Faire relire le plan par
   `lead-engineer-reviewer` + `tech-architect` (+ `ui-ux-designer` si UI) **en
   parallèle** avant `ExitPlanMode`.
2. **Découpage en sous-phases** (A / B / C…). À la fin de chacune, repasser la main
   pour test manuel.
3. **`pnpm check` vert** avant de proposer la fin d'une sous-phase. Pas d'exception.
4. **Review post-implémentation** : `lead-engineer-reviewer` toujours ; les autres
   selon ce qui est touché. En parallèle.

**Jamais de `git commit` / `git tag` / `git push` depuis l'agent.** L'utilisateur
fait ses commits lui-même. Proposer un message, c'est tout.

## herdr — mesuré sur la version 0.9.1

Vérifié contre un serveur réel (`herdr --session <nom> server`, isolé de la session
de travail), pas déduit du schéma.

- **Le socket est one-shot.** Une requête, une réponse, puis herdr ferme. Une
  deuxième requête sur la même connexion prend `EPIPE`. Le protocole ressemble à du
  JSON-lines multiplexé, il ne l'est pas. `lib/herdr/socket.ts` ouvre donc une
  connexion par appel.
- **`workspace.create --cwd <worktree>` ne lie rien.** `WorkspaceInfo.worktree`
  reste `null`. C'est **`worktree.open { cwd: <repo>, path: <worktree> }`** qui le
  remplit, avec `is_linked_worktree: true`. D'où : `wt` ouvre ses spaces par
  `worktree.open`, et c'est ce qui permet à herdr d'être le registre — donc pas de
  store d'état global à maintenir.
- `worktree.open` **exige `cwd`** (le repo source) en plus de `path`, sinon
  `invalid_request: workspace_id or cwd is required when no workspace is active`.
- **`layout.apply` prend `tab_id` OU `workspace_id`, jamais les deux** →
  `invalid_target`. Avec `tab_id`, il crée un **nouveau** tab (on passe `w3:t1`, il
  répond `w3:t2`) et de nouveaux panes ; l'ancien pane racine disparaît de
  `pane.list`, il n'y a pas d'orphelin à nettoyer.
- `pane_id` **est** peuplé dans la réponse de `layout.apply`, et les `label` font
  l'aller-retour. Le schéma les donne nullables, donc le repli par `pane.list` reste,
  mais il ne sert pas en pratique.
- `layout.apply` n'a **pas** de sous-commande CLI : le client socket est une
  nécessité, pas une optimisation.
- **Les capabilities du `ping` ne nomment aucune méthode.** Mesuré sur 0.9.1 :
  `live_handoff`, `detached_server_daemon`, `endpoint_protocol_generation`,
  `surface_interest`, `health_check`. Rien sur `layout.apply`, `worktree.open`,
  `agent.start` ni `pane.run`. On ne peut donc pas gater dessus ce que `wt`
  appelle, et gater sur `protocol === 22` reste exclu : un numéro qui bouge à
  chaque `brew upgrade` produit un warning ignoré en trois semaines. Le seul
  vrai garde-fou est **l'erreur renvoyée par l'appel**, traitée par le chemin
  générique. `wt doctor` liste les capabilities pour qu'une évolution se voie.
- Les codes d'erreur herdr sont des **chaînes libres**, non énumérées dans le schéma.
  Tout code inconnu passe par le chemin générique « rapporter et laisser trancher ».
