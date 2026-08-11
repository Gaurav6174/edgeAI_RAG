# The Jetson Deployment Saga — a study of `deploy_jetson.sh` and `demo_day_run.sh`

This is the linear story of how this project went from "runs fine on my laptop" to
"reliably boots on a booked NVIDIA Jetson Orin Nano slot, over a browser-only Web
Terminal, with zero SSH/SCP access." Every claim below is reconstructed from real
commits, real script comments, a real captured dry-run log, and the project's own
troubleshooting transcript (`complete_analysis.txt`) — nothing here is guessed. Read
it top to bottom once, then keep `deploy_jetson.sh`'s own comments as your
quick-reference during an actual session.

---

## 0. The constraint that shaped everything

The board — an NVIDIA Jetson Orin Nano — is accessed through **AiProff's Edge AI
Cloud Lab** (`edgeai.aiproff.ai`). You book a slot, get a browser-based Web Terminal,
and that's it: **no direct SSH, no SCP, no file upload**. The only way code gets onto
the board is `git pull`. And every booked session spins up a **fresh container** —
different hostname each time — so nothing survives between sessions except what's in
git and, usually (not always — see below), `~/.ollama`.

That single constraint is why almost every fix in this story takes the shape it does:
scripts have to be idempotent, self-diagnosing, and safe to re-run from scratch,
because "just SSH in and poke around" was never an option.

---

## 0.5. The SSH/SCP illusion, and why `nohup` wasn't enough

Before any of the scripts in this repo existed, the very first sessions on the board
ran into something worth spelling out on its own, because it's the root of §0's
constraint rather than just a symptom of it: **the documented access model and the
actual provisioned environment were two different things.**

The mentor/starter docs for the hackathon described a fairly normal bare-metal
workflow: SSH into the board, `scp` your files across, Ollama already installed and
running as a service. What the booked slots actually gave you was a **Docker
container standing in for the board** — reachable only through a browser-based
terminal — with none of that true:

- **`scp` was never reachable.** `hostname -I` on the board returned Docker-internal
  addresses (`172.17.x.x` / `172.18.x.x` — the classic Docker bridge subnet), not a
  real LAN/public IP. Nothing on your laptop has a route to those addresses; they
  only exist inside AiProff's own server network. This is the "tunnel" that got
  investigated and abandoned — there was no working tunnel, just the discovery that
  direct access genuinely wasn't offered, which is why the whole project pivoted to
  "sync everything through `git pull`" as the *only* way code reaches the board.
- **Ollama wasn't pre-installed**, at least not on the earliest sessions — contrary
  to the docs. It had to be installed and the model pulled by hand, burning real
  session time, before the later discovery (§8) that a *shared* Ollama instance
  eventually became the norm.
- **No `systemd`.** A real Jetson would run Ollama as a persistent system service.
  This container couldn't — so Ollama only ever existed as a plain background shell
  process, tied to whatever session started it.
- **A partially read-only filesystem** — `apt install python3.10-venv` would fail
  trying to upgrade `libpython3.10` because `/usr/lib/` was mounted read-only, even
  though the install itself often silently half-succeeded anyway.

**Why `nohup` shows up everywhere in the early logs:** the browser terminal is a
single shell. `ollama serve` and `uvicorn` are both long-running foreground
processes — start either one without backgrounding it and the terminal is stuck
tailing logs, unable to run the next `curl` test. `nohup ollama serve > ollama.log
2>&1 &` (and the same pattern for `uvicorn`) solved exactly that: background the
process, detach it from the terminal's hangup signal, keep the shell free.

What `nohup` could **not** solve was session death. Two different things could take
a backgrounded process down, and `nohup` only guards against one:

- The browser terminal disconnecting or timing out — `nohup` is designed to survive
  exactly this.
- The **container itself** being paused or torn down when the booked session ended
  — `nohup` has nothing to attach to anymore at that point. Every fresh booking
  meant reinstalling `zstd`, reinstalling Ollama, and restarting everything from
  zero, regardless of `nohup` — not because `nohup` failed at its job, but because
  the thing underneath the whole session was gone.

At one point disk usage hit **100% full** (`df -h ~` showing `0` bytes available),
and `nohup ollama serve` itself failed outright with `Exit 125` — it couldn't even
write its own log file. That's the concrete incident behind `deploy_jetson.sh`'s
otherwise-paranoid-looking "Step 0.5: Disk hygiene" — it had already broken the most
basic possible command once.

None of this — the unreachable IPs, the missing Ollama install, the read-only
filesystem, the sessions dying with everything on them — came from a mistake in this
project's code. It's the gap between "SSH in and `scp` your files" (what was
documented) and "ephemeral, semi-locked-down container behind a browser terminal"
(what was actually provisioned). The debugging work in the rest of this story is
what closing that gap looked like in practice.

---

## 1. First question: will the Python stack even install on this hardware?

Before writing a line of deploy tooling, the first real work was a compatibility
audit of `requirements.txt` against the Jetson's ARM64 (`aarch64`) architecture. The
verdict, worked out package by package against real PyPI wheel listings:

- `fastapi`, `uvicorn`, `python-multipart`, `httpx`, `python-dotenv`, `rank-bm25` —
  pure/near-pure Python, fine everywhere.
- `pymupdf` — has `manylinux_aarch64` wheels, but needs Python ≥3.9.
- `faiss-cpu==1.14.2` — has an `aarch64` wheel, but needs Python **≥3.10**. This
  became the tightest constraint in the whole stack.
- `torch` (a transitive dependency of `sentence-transformers`, not pinned directly)
  — this was the real landmine. PyPI only ships a **generic CPU-only** `aarch64`
  wheel for torch. NVIDIA doesn't publish standard Jetson wheels on PyPI at all —
  JetPack instead bundles its own NVIDIA-built torch (CUDA/Tegra-enabled) at the
  **system** Python level. If you let a plain `venv` install torch from PyPI, you
  silently lose all GPU acceleration and fall back to slow CPU inference.

The fix decided on here — and it holds for the rest of the story — was to build the
project's venv with **`--system-site-packages`**, so it inherits JetPack's
GPU-enabled torch instead of shadowing it with a generic PyPI one. This one decision
is the ancestor of the `--system-site-packages` line you'll see in every version of
`deploy_jetson.sh` below, and it's also the reason a whole category of later bugs
(`--system-site-packages` also leaks in *broken* system packages, not just good
ones — see the `pytz` incident in §5) had to get fixed rather than avoided.

---

## 2. Draft zero: `jetson_setup_track2.sh`, copied from the official guide

The very first script wasn't hand-written — it followed the hackathon's own
"Deploy to NVIDIA Jetson Orin" starter guide almost verbatim. It:

1. Checked `uname -m` for `aarch64` and printed `free -h`.
2. Ran `git pull origin main` to sync the board with GitHub (the *only* sync
   mechanism available, per §0).
3. `pip install`'d the RAG-specific packages directly (no venv yet at this stage).
4. Sanity-checked the Ollama REST API on the board with a `curl` to
   `http://172.17.0.1:11434/api/generate`.

That last step is where the story's second big discovery happened: **the board
already runs its own Ollama server**, reachable not at `localhost` but at
`172.17.0.1` — the Docker bridge gateway IP, because the app itself runs inside a
container and Ollama runs on the host. It comes pre-loaded with the one approved
model, `llama3.2:1b`, and the guide is explicit: **do not `ollama pull`, install, or
restart it.** This is why `backend/.env` has an `OLLAMA_HOST` block specifically for
"jetson board running" that points at `172.17.0.1:11434` instead of `localhost`.

The script also already encoded a workaround for something that clearly bit someone
during testing: the first `/api/generate` call after the board sits idle can return

```
{"error":"llama runner process has terminated: %!w(<nil>)"}
```

with HTTP 500 — the GPU context has to cold-start. `jetson_setup_track2.sh` retried
the warm-up call up to 5 times with 2-second sleeps before giving up, and pointed at
a dedicated diagnostic script for when that wasn't enough.

---

## 3. The diagnostic script born from a real 500 error

`jetson_ollama_diagnose.sh` exists because the retry-5-times trick sometimes still
wasn't enough to explain *why* the runner had terminated. It's a pure troubleshooting
script, not part of normal deploy flow:

1. `GET /api/tags` — does the server even see the model as loaded?
2. `GET /` — is the Ollama process itself alive at all?
3. `free -h` — memory snapshot.
4. `tegrastats` / `nvidia-smi` — GPU status, when available inside the container
   (often it isn't — "normal inside a container" per the script's own comment).
5. Retry the plain generate call 3 more times.
6. Retry again, this time **with** the exact options block the app uses:
   `num_ctx=1024, num_gpu=1, use_mmap=true`.

That last step mattered: the difference between a bare `/api/generate` call and one
with those specific options was the difference between reproducing the failure and
not. From here on, every Ollama call anywhere in the project — the diagnose script,
the setup script, and eventually `deploy_jetson.sh` and `backend/llm.py` — carries
that exact options block and generous timeouts. `errors.md` (§7 below) later nailed
the root cause precisely: it's not a permanent failure, it's a **cold-start timeout**
— the default request timeout (30s) is shorter than the GPU context's cold boot time,
so `llm.py` needed 3-attempt retry logic and a 120-second timeout, not a shorter one.

---

## 4. Failing fast: `preflight_check.sh`

Once the setup script existed, the team learned the hard way that a full deploy
attempt on this platform is *expensive* — every retry burns minutes of a booked
slot re-pulling git, re-creating venvs, re-downloading models. So a separate
`preflight_check.sh` was added whose entire job was to fail in **seconds**, before
any of that heavy lifting starts, if something fundamental was already wrong:
architecture, Python version, reachability of `ollama.com` / `huggingface.co` /
`pypi.org`, required project files, and — critically — disk and memory headroom,
printed as full diagnostics (biggest directories under `$HOME`, `~/.ollama` size,
`~/.cache` size) rather than a bare pass/fail, because a "fresh" container that's
already low on disk almost always meant leftover cruft from an *earlier* booking on
persistent storage, not a new problem. The script's own comment sums up the
motivating incident: *"This took seconds instead of burning your test window."*

---

## 5. `deploy_jetson.sh` v1 (17 Jul) — the naive, self-sufficient version

The first real `deploy_jetson.sh` assumed the session owned its whole stack end to
end: install `zstd`, install Ollama itself (`curl -fsSL https://ollama.com/install.sh
| sh`), `ollama serve` in the background, `ollama pull llama3.2:1b`, *then* set up
Python and start the backend. Its own top comment already documents the first
disk-related incident: containers ship with **~108–111 GB already consumed** by the
base image, leaving only 3–5 GB of headroom, and a bare `"No space left on device"`
had already killed a whole session once. So step 0.5 was disk hygiene — purge the
pip cache, `apt-get clean`, and remove known stray `~/.local` copies of the project's
heavier packages (numpy, scipy, sentence_transformers, transformers, sklearn, faiss)
left behind by earlier `pip install --user` troubleshooting.

That per-package `~/.local` cleanup, and the reasoning behind it, is the seed of the
story's most persistent bug class.

---

## 6. The `.local`-vs-`.venv` shadowing bug — the same bug wearing two costumes

This is the single most time-consuming failure mode in the whole project, and it
looked like *two different bugs* before anyone realized it was one.

**Costume 1 — the "why does `pip install --user` still show up" bug.** Across
multiple booked sessions, people ran ad-hoc `pip install --user X` while
troubleshooting. Those packages land in `~/.local/lib/python3.x/site-packages/`,
which Python adds to `sys.path` **in addition to** the active venv — silently. A
partial cleanup (deleting just a handful of named packages, as v1's disk-hygiene
step did) never fully closed this door, because the next session's troubleshooting
just left different stray packages behind.

**Costume 2 — "it works in `python3 -c` but crashes when uvicorn runs it."** This
is `errors.md`'s issue #1, and it's worth walking through exactly because it's a
genuinely subtle bug: the startup command used a *relative* activation,
`. .venv/bin/activate && python3 -m uvicorn main:app ...`. That only resolves
correctly if the shell's current working directory is the project root. Run it from
`backend/` instead (easy to do by accident), and `.venv/bin/activate` silently
doesn't exist — the `source` command fails quietly, `python3` falls back to the
**system** interpreter, and *that* one happily loads `~/.local`. An interactive
`python3 -c "import sentence_transformers"` check run from the project root, on the
other hand, activates correctly and shows a clean `.venv` path — so the exact same
project looked broken in one execution context and fine in another, which is exactly
what made it look like two unrelated bugs at first.

**The actual fix, arrived at in two stages:**

- `c9a51e4` (19 Jul) escalated from surgical per-package deletion to **wholesale**
  `rm -rf ~/.local` in the disk-hygiene step — because, per that commit's own
  comment, `~/.local` had "zero legitimate use in this workflow" and kept
  accumulating multi-GB of stale torch/numpy/transformers copies session after
  session regardless of which packages got named in the cleanup list.
- The startup command switched to the **absolute path** to the venv's Python
  (`$PROJECT_DIR/.venv/bin/python3 -m uvicorn ...`), combined with
  **`export PYTHONNOUSERSITE=1`** set unconditionally at the top of every script.
  `PYTHONNOUSERSITE` is the belt to the absolute-path suspenders: even if something
  re-enables user-site packages later, Python won't add `~/.local` to `sys.path` at
  all. `deploy_jetson.sh` also added a standing verification step after every
  install:

  ```python
  import sentence_transformers, numpy, transformers
  for mod in (sentence_transformers, numpy, transformers):
      assert '.local' not in mod.__file__, f'{mod.__name__} is loading from .local!'
  ```

That assertion step still runs today, as "Step 4: Verify no .local contamination" —
it's cheap insurance against a bug that had already cost real time twice.

---

## 7. Same week, a second install-time failure: `ensurepip is not available`

Still in the 19 July window, `venv` creation itself started failing on some sessions
with `ensurepip is not available` — the `python3.10-venv` system package wasn't
installed, and the base container image was partially read-only, so a plain retry
didn't help. `8a1f922` replaced the single `python3 -m venv .venv
--system-site-packages` call with a three-tier fallback that's still in the script
verbatim today:

1. Try the normal venv creation.
2. If that fails, try `apt-get install -y python3.10-venv` (with and without
   `sudo`, since sudo access wasn't guaranteed either) and retry.
3. If *that* still fails, create the venv with `--without-pip`, activate it, and
   manually bootstrap pip via `curl … get-pip.py | python3 -`.

Rather than aborting the whole run on the first failure mode encountered, the script
now degrades gracefully through three strategies before giving up.

---

## 8. The pivot: stop trying to own Ollama

Between the 19 July fixes and the next batch of changes on 5 August, the project
made its biggest strategic reversal: **it stopped installing, serving, and pulling
Ollama on the board at all.** Every earlier version (`jetson_setup_track2.sh`,
`deploy_jetson.sh` v1) had treated the board's Ollama server as something *this
project* stood up each session — installing the binary, backgrounding `ollama
serve`, running `ollama pull llama3.2:1b` (budgeting "5–10 minutes every session"
for it, per v1's own header comment). But per §2, the board's Ollama was *already
running externally*, pre-loaded with the one approved model, specifically so nobody
needs to do this — and the official platform docs said so explicitly.

The rewritten `deploy_jetson.sh` (first the `c7c8ea8`/`47dd822` consolidation, then
polished through `5a73479`/`c70a031` — see §10) replaced the entire
install-serve-pull sequence with a **verification-only** step: hit the board's
existing `172.17.0.1:11434/api/generate` with the exact options block from §3, retry
5 times for the known cold-start flakiness, and — if it *still* doesn't respond —
stop and print rich diagnostics (`/api/tags`, `free -h`, `nvidia-smi`) rather than
attempting to fix it locally, because "the board's shared Ollama service itself is
down… that's a platform issue, not something to fix by installing a local Ollama."
This also folded `jetson_ollama_diagnose.sh`'s job directly into the main script
instead of keeping it as a separate manual step.

This single change is why the *current* `deploy_jetson.sh` budgets "a few minutes
per session for pip installs" instead of the original "5-10 minutes… there is no
way to skip this" — most of that original time was spent on infrastructure the
project never needed to own in the first place.

---

## 9. `errors.md` — writing down everything, all at once (5 Aug)

On 5 August the team sat down and wrote `errors.md`, a catalogue of every issue hit
so far plus fixes, explicitly so future sessions wouldn't repeat them before a demo.
Issues #1 (the `.local`/`.venv` shadowing bug, §6) and #5 (Ollama cold-start
timeouts, §3) were already covered above. The two new ones it documented:

**Issue #2 — the `pytz`/`tzdata.zi` crash.** Because the venv uses
`--system-site-packages` (§1's deliberate choice, to keep JetPack's GPU torch),
Ubuntu's ancient system `pytz` (2022.1) becomes importable too — and it reads
`/usr/share/zoneinfo/tzdata.zi` at import time, unconditionally. That file comes
from the `tzdata` **system package**, which isn't installed on this Jetson image.
`pytz` isn't even a direct dependency of the project — it arrives transitively via
`sentence-transformers → sklearn → pandas → pytz`, which made it a genuinely
confusing crash the first time it was hit. This is the direct cost of the
`--system-site-packages` decision: it fixes torch but also un-hides a broken system
package that a clean venv would never have seen. The fix: `pip install --no-user
--ignore-installed -U pytz` **inside** the venv, so a fresh, working `pytz` shadows
the broken system one without touching system state (`--ignore-installed` matters —
without it, pip sees the system copy already "satisfies" the requirement and
installs nothing).

**Issue #3 — the frontend's build toolchain didn't match the board's Node.js.**
The Jetson image ships Node 18.20.8; Vite 8 needs Node ≥20.19 or ≥22.12. Building
under Node 18 also meant the platform-specific native binary
`@rolldown/binding-linux-arm64-gnu` silently failed to download (a known npm
optional-dependency bug), so `vite build` failed twice over. A workaround existed —
download a prebuilt Node 22 aarch64 tarball, prepend it to `PATH`, reinstall — but
`errors.md` itself flags the real takeaway: **the frontend is optional for the
demo.** The FastAPI backend serves the full RAG API on its own; only the build step
needs Node at all. This observation is exactly what later commit `3da8948` acted on
(§11) — rather than keep maintaining a Node-version workaround forever, it deleted
the Vite/React build step from the deploy path entirely.

`errors.md` also flagged issue #6: `backend/.env`'s `CONFIDENCE_THRESHOLD` was set
to `0.0` on the board (vs. the README's recommended `0.35`), meaning almost every
query — even irrelevant ones — passed the confidence gate and reached the LLM. It
was left at `0.0` intentionally, for maximum recall during testing, with a note to
raise it to `0.35` before a real demo. As of this writing, `backend/.env` **still
has it at `0.0`** for the Jetson block — worth checking before your next demo.

---

## 10. Same day: a real correctness bug, and a commit that ate itself

Also on 5 August, alongside the deploy-script consolidation, a genuine logic bug was
found and fixed in `backend/retriever.py`. The cross-encoder reranker
(`cross-encoder/ms-marco-MiniLM-L-6-v2`) returns **unbounded raw logits** — typically
somewhere in `-8..8` — not a 0–1 probability. But `CONFIDENCE_THRESHOLD` in `.env`
and the frontend's percentage confidence badge were both written assuming a 0–1
scale. The fix: sigmoid-normalize the reranker's scores
(`reranker.predict(pairs, activation_fct=torch.nn.Sigmoid())`) so the number
flowing into the threshold check and the UI badge actually means what both of them
assume it means. A companion fix in `ingest.py` stopped `save_index()` from
re-encoding every chunk's embeddings a second time when `build_index()` had already
computed them once.

The commit that was *supposed* to ship all of this, `c7c8ea8`, only actually
committed the **deletion** of the three old scripts (`preflight_check.sh`,
`jetson_setup_track2.sh`, `jetson_ollama_diagnose.sh`) — a `git add` pathspec error
on an already-removed file aborted partway through staging, so the retriever fix,
the ingest fix, and the new consolidated `deploy_jetson.sh` content never made it
into that commit at all. It took a follow-up commit, `47dd822`, explicitly labeled
as recovering `c7c8ea8`'s intended changes, to actually land them. (A small, human
reminder that `set -e`-style "did it actually work" verification applies to your own
git workflow too, not just the deploy script.)

That same day produced `dry_run_output.txt` — a captured, successful end-to-end run
against the real 160-chunk handbook index: a health check, and three real questions
("What is the Code of Student Conduct?", "What are the student conduct
procedures?", "What is the academic integrity policy?"), each answered correctly
with page-cited content. This is the first point in the story where there's
concrete proof the consolidated pipeline actually worked, not just that it should.

---

## 11. Two last hardening passes (9 Aug), then the frontend problem disappears entirely

Two small, tersely-named commits (`5a73479` "killed", `c70a031` "killed2") shipped
two more real fixes:

- **A hardcoded path.** `demo_day_run.sh` (a second, parallel deploy script — see
  §12) had `PROJECT_DIR="/home/codex/edgeAI_RAG"` hardcoded — the original author's
  exact clone path. On any board where the repo landed somewhere else, the whole
  script would `cd` into a directory that didn't exist. Replaced with
  `PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` — derive it from
  wherever the script actually is. This same commit also finally folded the `pytz`
  fix from `errors.md` issue #2 (§9) into `deploy_jetson.sh` itself as an explicit
  step — the documentation had existed for four days before the script actually
  encoded it.
- **A `set -e` trap.** In the Ollama-verification retry loop (§8), `RESP=$(curl
  ...)` with no fallback meant that if `curl` failed at the connection level
  (refused/timeout — not just a bad HTTP response), the bare assignment's non-zero
  exit code would trip `set -e` and **kill the entire script silently**, before the
  retry loop even got a chance to print `attempt 1: no response yet...`. The fix is
  a one-line `|| RESP=""` on the assignment — cheap, and the kind of bug that's
  only obvious once you've watched a script die with zero output and gone looking
  for why.

Then, in `3da8948` ("Replace React frontend with plain HTML/CSS/JS…"), the Node
version mismatch from `errors.md` issue #3 stopped being a bug to work around and
became a bug that **couldn't happen anymore**: the Vite/React frontend was replaced
with a zero-build-step plain HTML/CSS/JS app served directly from `backend/public/`.
The commit message says it outright: *"Removes the Vite/npm build step entirely —
one less point of failure for the Jetson demo."* `errors.md` itself was deleted in
the very next frontend-related commit (`6477fd9`) — its lessons had already been
folded into `deploy_jetson.sh`'s own header comments, and the one lesson it couldn't
fold in (the Node version problem) had been made structurally impossible instead of
merely documented.

---

## 12. A loose thread: two deploy scripts, not one

The repo actually carries **two** top-level deploy scripts, and they're not fully in
sync:

- **`deploy_jetson.sh`** — the one this whole story has been about. Self-contained,
  fails fast on preflight, verifies (never installs) the board's Ollama, has the
  full `.local`/venv/pytz hardening baked in, rebuilds the FAISS index natively at
  the end, and starts the backend. This is the canonical, current script.
- **`demo_day_run.sh`** — added the same day as `errors.md` (5 Aug), as a more
  "operational" wrapper: colored `[OK]/[FAIL]/[WARN]` output, PID-file-based backend
  management (so a re-run cleanly kills the previous instance instead of erroring
  on a bound port), and — usefully — baked-in dry-run test queries against `/query`
  and `/citations` at the end, so a single run both deploys *and* proves the API
  answers correctly. It assumes the venv and index already exist rather than
  building them (see its own "Prerequisites" comment), and its final summary still
  mentions `backend/public/dist` as the frontend location — a leftover from before
  `3da8948` deleted the Vite build entirely, so that line is stale in the current
  repo layout (the frontend now lives at `backend/public/` directly, no `dist/`).

In short: run `deploy_jetson.sh` first to actually get the environment and backend
up from a fresh container; `demo_day_run.sh` is closer to a healthcheck-and-smoke-test
script for a board that's already been set up, with one now-outdated comment about
where the frontend lives.

---

## 13. The actual golden path — what finally worked, end to end

Everything above explains *why* the tooling looks the way it does. This section is
the payoff: the exact sequence that took a fresh booked slot to a working demo —
backend up, frontend reachable in an actual browser, a document ingested, and a
question answered with citations.

1. **`git clone`** the repo onto the fresh container — the only sync path, per §0/§0.5.
2. **`cd`** into the project directory.
3. **Fix `backend/.env`** — specifically `OLLAMA_HOST`, so it points at the board's
   Ollama (`http://172.17.0.1:11434`, the Docker bridge gateway from §2/§8) rather
   than `localhost`. This is the one manual edit every fresh session needs, since
   `.env` isn't something a generic deploy script should overwrite for you.
4. **`chmod +x` and run `deploy_jetson.sh`, then `demo_day_run.sh`.** Between them
   this does everything §1–§10 describe — preflight checks, disk hygiene, verifying
   (not installing) the board's Ollama, building the hardened venv, rebuilding the
   FAISS index, and starting `uvicorn` — and brings the backend up on
   `0.0.0.0:8000` inside the container.
5. **`npm install -g localtunnel`, then expose port 8000.** This is the step none of
   the committed scripts handle, and it's solving the exact problem §0.5 already
   named: the board's `0.0.0.0:8000` is only reachable *inside* the container's
   network — your laptop has no route to it, same as the Docker-bridge IPs that
   made direct `scp` impossible in the first place. `localtunnel` opens an outbound
   connection from the board to a public relay and hands back a public URL that
   forwards to `localhost:8000` on the board. That URL is what actually opened in a
   browser — not the board's own IP, which was never reachable — and from there the
   plain HTML/JS frontend (§11) could upload a PDF, trigger ingestion, and run a
   real query against it.

Steps 1–4 are captured, in more defensive/idempotent form, in the two committed
scripts. Step 5 (or something equivalent to it — `localtunnel`, `cloudflared`,
`ngrok`, or whatever the platform's dashboard might expose directly) still isn't
automated by any script — it's a manual step every session. It's also doing double
duty: it's not just reaching the API anymore, but the whole app, since (as of this
write-up) `backend/main.py` serves a pre-built, git-committed `frontend/dist/`
directly from the same port. One `localtunnel` on `:8000` now covers both — see the
README's "Project structure" and Phase 2 sections for the current setup.

---

## Was this normal? Whose fault was it?

Worth separating two categories of pain before the recap, because they have
different answers.

**The ARM/edge-deployment friction** — torch having no GPU-enabled PyPI wheel for
Jetson (§1), `--system-site-packages` un-hiding a broken system `pytz` (§9), a
reranker returning the wrong numeric scale (§10), Node 18 vs. Vite 8 (§9) — is
roughly par for the course the first time you deploy an ML stack to unfamiliar
embedded/ARM hardware. Annoying, but the kind of thing any real deployment to novel
hardware turns up, and exactly what the debugging trail in this document (preflight
scripts, a diagnose script, `errors.md`, retries) is *supposed* to look like: not a
sign anything was done wrong, but evidence a real problem got worked through
systematically.

**The platform-access pain** — unreachable IPs where `scp` should have worked,
Ollama missing where the docs said it'd be pre-installed, no `systemd`, sessions
(and everything running in them) disappearing without warning, a disk that started
at 100% full — is not normal, and isn't something to carry as a personal failure.
§0.5 covers this directly: a real bare-metal Jetson with SSH, `scp`, and a service
manager would have made most of it simply not happen. What got documented wasn't
"how deployment is generally done" — it was "how you cope when the access model you
were promised isn't the one you were given," which is a harder problem than a
normal deploy, solved with no shell access to fall back on if the terminal itself
went away.

---

## TL;DR — what ultimately worked

1. **Sync via `git pull` only** — the platform gives you nothing else.
2. **`python3 -m venv .venv --system-site-packages`**, with a 3-tier fallback
   (plain → install `python3.10-venv` → `--without-pip` + manual `get-pip.py`) —
   needed to inherit JetPack's GPU-enabled torch instead of a CPU-only PyPI wheel.
3. **`export PYTHONNOUSERSITE=1`, always**, plus an absolute path to the venv's
   Python on every invocation, plus a standing `'.local' not in mod.__file__`
   assertion after install — kills the `.local`-vs-`.venv` shadowing bug for good.
4. **`rm -rf ~/.local` wholesale** in disk hygiene, every session — partial,
   per-package cleanup wasn't enough.
5. **`pip install --ignore-installed pytz`** inside the venv, to shadow the
   system `pytz` that crashes on a missing `tzdata.zi` — a direct, necessary side
   effect of decision #2.
6. **Never install/serve/pull Ollama on the board.** Only verify the existing
   service at `OLLAMA_HOST` (the Docker bridge gateway, `172.17.0.1:11434`) with
   retries and the exact `num_ctx=1024, num_gpu=1, use_mmap=true` options, generous
   (120s) timeouts, and rich failure diagnostics instead of attempting a local fix.
7. **Rebuild the FAISS index natively** on the board right before starting the
   backend, to sidestep any numpy/FAISS ABI mismatch between however the index was
   originally built and whatever's installed on this particular session.
8. **No frontend build step at all** — a plain HTML/CSS/JS app served straight from
   `backend/public/` eliminated the entire Node-version failure class rather than
   working around it.
9. **`set -e` discipline**: guard every command whose failure mode includes "exits
   non-zero before printing anything" with `|| true` / `|| VAR=""`, or the script
   dies silently and looks like it hung.
10. **`localtunnel` (or equivalent) to actually reach the frontend.** The backend
    binding to `0.0.0.0:8000` only makes it reachable *inside* the board's own
    network — same unreachable-from-your-laptop problem as the Docker-bridge IPs in
    §0.5. `npm install -g localtunnel` plus exposing port 8000 hands back a public
    URL that forwards to it, which is what actually opens in a browser to ingest a
    document and run a query. Not in any committed script yet — see §13.

Everything above except #10 is currently encoded in `deploy_jetson.sh`'s six numbered steps —
read its comments alongside this document if you're about to run it on a fresh
booked slot.
