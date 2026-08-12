// Build tether end-to-end: sequential core, parallel languages/surfaces,
// dogfood with .tether files, review + adversarial verify, goal alignment.
// Same branch, same folder. Own your paths. Commit every deliverable.

let meta = #{
    name: "build-tether",
    description: "Build the tether CLI: foundation, language extract, facts, wiki, search; review and align to the stale-docs problem",
    when_to_use: "When implementing or extending tether in ~/Projects/tether",
    phases: [
        #{ title: "Align", detail: "lock invariants against root.tether; escalate hard questions" },
        #{ title: "Foundation", detail: "CLI spine, git gate, home dir, extract IR" },
        #{ title: "Languages", detail: "parallel tree-sitter profiles + fixtures" },
        #{ title: "Extract", detail: "adjacency, fingerprint, syntax, resolution" },
        #{ title: "Surfaces", detail: "parallel extract/lint/compile/search/doctor commands" },
        #{ title: "Dogfood", detail: "document this repo with tether" },
        #{ title: "Review", detail: "independent review dimensions" },
        #{ title: "Verify", detail: "adversarial check of review findings" },
        #{ title: "Goal", detail: "alignment with the original poison/tax problem" },
        #{ title: "Skill", detail: "refresh skills/tether from what shipped" },
    ],
};

let commit_schema = #{
    "type": "object",
    "required": ["ok", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "commit": #{ "type": "string" },
        "files": #{ "type": "array", "items": #{ "type": "string" } },
        "summary": #{ "type": "string" },
        "blocked": #{ "type": "boolean" },
        "blocked_reason": #{ "type": "string" },
        "questions": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 6 },
    },
};

let findings_schema = #{
    "type": "object",
    "required": ["findings"],
    "properties": #{
        "findings": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "required": ["file", "issue"],
                "properties": #{
                    "file": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                },
            },
        },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["real", "reason", "evidence"],
    "properties": #{
        "real": #{ "type": "boolean" },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
    },
};

let align_schema = #{
    "type": "object",
    "required": ["ok", "aligned", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "aligned": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "gaps": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 8 },
        "questions": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 6 },
    },
};

let max_phase = "all";
if args != () {
    if args.max_phase != () { max_phase = args.max_phase; }
}

fn phase_rank(name) {
    if name == "align" { return 0; }
    if name == "foundation" { return 1; }
    if name == "languages" { return 2; }
    if name == "extract" { return 3; }
    if name == "surfaces" { return 4; }
    if name == "dogfood" { return 5; }
    if name == "review" { return 6; }
    if name == "verify" { return 7; }
    if name == "goal" { return 8; }
    if name == "skill" { return 9; }
    if name == "all" { return 99; }
    99
}

let stop_rank = phase_rank(max_phase);
let questions = [];

fn collect_questions(bag, out) {
    if out == () { return bag; }
    if out.questions == () { return bag; }
    for q in out.questions {
        if bag.len() < 16 { bag.push(q); }
    }
    bag
}

fn is_blocked(out) {
    if out == () { return false; }
    if out.blocked == true { return true; }
    false
}

let COMMIT_LAW = "";
COMMIT_LAW += "COMMIT LAW:\n";
COMMIT_LAW += "1. Working directory is /Users/guilhermecastro/Projects/tether only.\n";
COMMIT_LAW += "2. Other agents work in this tree. git status first. Touch only paths you own.\n";
COMMIT_LAW += "3. Never delete, revert, reset, stash, or overwrite files you did not create this turn.\n";
COMMIT_LAW += "4. Do not rewrite README.md, root.tether, AGENTS.md, skills/tether/SKILL.md, ";
COMMIT_LAW += "or .grok/workflows/ unless your phase explicitly owns that file.\n";
COMMIT_LAW += "5. After the deliverable works, stage ONLY your files and commit. Never leave dirty patches.\n";
COMMIT_LAW += "6. Conventional Commits. Do not push.\n";
COMMIT_LAW += "7. If someone else's uncommitted files are in the way, skip them and report blocked=false with a note.\n";

let REPO = "";
REPO += "Repo: /Users/guilhermecastro/Projects/tether (git repo). Read AGENTS.md and root.tether first.\n";
REPO += "Stack: Bun + TypeScript + Effect + @effect/cli, JSON-first agentic CLI. web-tree-sitter 0.25.10.\n";
REPO += "State lives in $TETHER_HOME or ~/.config/tether/projects/<git-key>/ — never a .tether/ dir in the repo.\n";
REPO += "Quartz is out of v1. Do not add a quartz dependency.\n";
REPO += "Use read_file, grep, and the shell. Do not answer from memory about this tree.\n";

// ── Align ────────────────────────────────────────────────────────────────
phase("Align");
log("Checking invariants against root.tether and README");

let align_prompt = "";
align_prompt += REPO;
align_prompt += "TASK: Read README.md, root.tether, AGENTS.md, skills/tether/SKILL.md, package.json.\n";
align_prompt += "Confirm the locked invariants: git required; location is the bind; facts only; ";
align_prompt += "no bind table; compile never committed; AGENTS.md is honorary pre-steer.\n";
align_prompt += "Do NOT edit files. List at most 6 operator questions if a product hole would block implementation.\n";
align_prompt += "Set aligned=true only if the written spec is enough to implement without inventing policy.\n";
align_prompt += "ok=true if you completed the read.\n";

let align_r = agent(align_prompt, #{
    label: "align-spec",
    capability_mode: "read-only",
    output_schema: align_schema,
});

if align_r != () && align_r.success && align_r.output != () {
    questions = collect_questions(questions, align_r.output);
    if is_blocked(align_r.output) {
        await_user("user", align_r.output.blocked_reason);
    }
}

if stop_rank < 1 {
    complete(#{ summary: "Stopped after align", questions: questions });
}

// ── Foundation ───────────────────────────────────────────────────────────
phase("Foundation");
log("CLI spine, git gate, home, extract IR");

let found_prompt = "";
found_prompt += REPO;
found_prompt += COMMIT_LAW;
found_prompt += "OWN: src/cli.ts, src/core/**, src/extract/types.ts, src/extract/languages/index.ts, ";
found_prompt += "src/commands/discovery.ts, test/helpers/cli.ts. You may extend package.json scripts only.\n";
found_prompt += "TASK: Scaffold the agentic JSON CLI (doctor, capabilities, schema, examples) ";
found_prompt += "following agentic-cli-template at /Users/guilhermecastro/Projects/agentic-cli-template.\n";
found_prompt += "Must: git required (fail if not a repo); TETHER_HOME / ~/.config/tether; ";
found_prompt += "typed TaggedErrors; extract IR types matching root.tether (Tether, Host, FactKind, Ref).\n";
found_prompt += "languages/index.ts exports a registry type and empty/partial table others will fill.\n";
found_prompt += "Do not implement extract/lint/compile/search yet.\n";
found_prompt += "bun install if needed. bun run typecheck. Commit feat(cli): foundation spine and extract IR.\n";

let found_r = agent(found_prompt, #{
    label: "foundation",
    capability_mode: "all",
    output_schema: commit_schema,
});

if found_r != () && found_r.success && found_r.output != () {
    questions = collect_questions(questions, found_r.output);
    if is_blocked(found_r.output) {
        await_user("user", found_r.output.blocked_reason);
    }
}

if stop_rank < 2 {
    complete(#{ summary: "Stopped after foundation", questions: questions });
}

// ── Languages (parallel, disjoint files) ─────────────────────────────────
phase("Languages");
log("Parallel language profiles");

let lang_ids = ["javascript", "typescript", "rust", "golang", "ruby", "swift", "python"];
let lang_exts = [
    "js,mjs,cjs",
    "ts,tsx (tsx grammar)",
    "rs",
    "go (id golang — file golang.ts)",
    "rb",
    "swift",
    "py",
];

let lang_jobs = [];
let li = 0;
for id in lang_ids {
    let ext = lang_exts[li];
    let lp = "";
    lp += REPO;
    lp += COMMIT_LAW;
    lp += "OWN only: src/extract/languages/";
    lp += id;
    lp += ".ts and test/fixtures/";
    lp += id;
    lp += "/ (create the dir). ";
    lp += "You may add one export line in src/extract/languages/index.ts if the registry already exists.\n";
    lp += "TASK: Language profile for ";
    lp += id;
    lp += " (extensions ";
    lp += ext;
    lp += "). web-tree-sitter + that grammar's wasm. Table: comment node types, skip types ";
    lp += "(decorators/attributes), declaration types, unwrap types (export/impl wrappers), name extraction.\n";
    lp += "javascript and typescript share comment/decl shapes; tsx uses the tsx wasm. ";
    lp += "golang file must be golang.ts (do not name a file go.ts if it confuses tools).\n";
    lp += "Do not add elixir or cpp profiles.\n";
    lp += "Fixture: one marked @tether comment immediately above a declaration; one negative (comment inside a body).\n";
    lp += "Do not implement the walker. Just the profile + fixture + a tiny unit test that the profile table is complete.\n";
    lp += "Commit test(extract): ";
    lp += id;
    lp += " language profile.\n";
    lang_jobs.push(#{
        prompt: lp,
        label: "lang-" + id,
        capability_mode: "all",
        output_schema: commit_schema,
    });
    li += 1;
}

let lang_results = parallel(lang_jobs);
for lr in lang_results {
    if lr != () && lr.success && lr.output != () {
        questions = collect_questions(questions, lr.output);
    }
}

if stop_rank < 3 {
    complete(#{ summary: "Stopped after languages", questions: questions });
}

// ── Extract ──────────────────────────────────────────────────────────────
phase("Extract");
log("Adjacency, fingerprint, syntax, refs");

let extract_specs = [
    #{
        id: "parser",
        files: "src/extract/parser.ts",
        task: "Init web-tree-sitter once, load grammar wasm per language, parse source to a tree. Copy pulsar locateFile pattern from /Users/guilhermecastro/Projects/pulsar/packages/rs-pack/src/syn-walker.ts. Pin runtime 0.25.x with the grammar wasm ABI.",
    },
    #{
        id: "adjacency",
        files: "src/extract/adjacency.ts",
        task: "Walk ALL children including extras. Pending marked comments bind to the next declaration. Whitespace-only gap. Skip decorator/attribute nodes. Unwrap export wrappers. Not nearest-enclosing. Tests for inner-comment-does-not-bind.",
    },
    #{
        id: "fingerprint",
        files: "src/extract/fingerprint.ts",
        task: "fp = grammar-prefixed hash of preorder node types + leaf token text, no positions, skip comment extras. shape = fp with decl name field replaced by $NAME. Tests: reformat stable, rename changes fp, shape match across rename.",
    },
    #{
        id: "syntax",
        files: "src/extract/syntax.ts src/extract/resolve.ts",
        task: "Parse sidecar .tether and @tether comments: @symbol, @ref path#Name, doc {}. Resolve refs against the declaration index. emit Tether records. ill_formed on @symbol mismatch with adjacency.",
    },
];

let ex_jobs = [];
for spec in extract_specs {
    let ep = "";
    ep += REPO;
    ep += COMMIT_LAW;
    ep += "OWN: ";
    ep += spec.files;
    ep += " and tests under test/extract/ for that module.\n";
    ep += "TASK: ";
    ep += spec.task;
    ep += "\nRead root.tether Extract + Language sections. Use existing IR types and language profiles.\n";
    ep += "Commit feat(extract): ";
    ep += spec.id;
    ep += ".\n";
    ex_jobs.push(#{
        prompt: ep,
        label: "extract-" + spec.id,
        capability_mode: "all",
        output_schema: commit_schema,
    });
}

let ex_results = parallel(ex_jobs);
for er in ex_results {
    if er != () && er.success && er.output != () {
        questions = collect_questions(questions, er.output);
    }
}

if stop_rank < 4 {
    complete(#{ summary: "Stopped after extract", questions: questions });
}

// ── Surfaces ─────────────────────────────────────────────────────────────
phase("Surfaces");
log("extract, lint, compile, search, doctor commands");

let surfaces = [
    #{
        id: "extract-cmd",
        files: "src/commands/extract.ts src/extract/walk.ts",
        task: "git ls-files walk, extract all tethers, JSON envelope. Input schema {root}.",
    },
    #{
        id: "lint",
        files: "src/commands/lint.ts src/facts/lint.ts",
        task: "Emit the closed fact kinds from root.tether. No severity text. fail_on from optional .tether.json (default all kinds). Exit 1 when any selected kind is present.",
    },
    #{
        id: "compile",
        files: "src/commands/compile.ts src/compile/wiki.ts",
        task: "Write mirrored wiki under the project cache dir, never the repo. Stack merge order from root.tether. Frontmatter is facts only.",
    },
    #{
        id: "search",
        files: "src/commands/search.ts src/search/index.ts",
        task: "SQLite FTS5 over extract plus local embeddings if a small ONNX path is already easy; otherwise FTS + fusion stub that is honest in capabilities. Index extract, not wiki.",
    },
    #{
        id: "doctor",
        files: "src/commands/doctor.ts",
        task: "Git present, wasm grammars load, home dir writable, schema/examples wired. Extend the foundation doctor; do not replace unrelated discovery commands.",
    },
];

let surf_jobs = [];
for s in surfaces {
    let sp = "";
    sp += REPO;
    sp += COMMIT_LAW;
    sp += "OWN: ";
    sp += s.files;
    sp += " plus tests for that command. You may register the command in src/cli.ts with a one-line subcommand add.\n";
    sp += "TASK: ";
    sp += s.task;
    sp += "\nJSON-first: inline / @file / stdin. No --json flag. Commit feat(cli): ";
    sp += s.id;
    sp += ".\n";
    surf_jobs.push(#{
        prompt: sp,
        label: "surf-" + s.id,
        capability_mode: "all",
        output_schema: commit_schema,
    });
}

let surf_results = parallel(surf_jobs);
for sr in surf_results {
    if sr != () && sr.success && sr.output != () {
        questions = collect_questions(questions, sr.output);
    }
}

if stop_rank < 5 {
    complete(#{ summary: "Stopped after surfaces", questions: questions });
}

// ── Dogfood ──────────────────────────────────────────────────────────────
phase("Dogfood");
log("Document tether with tether");

let dog_prompt = "";
dog_prompt += REPO;
dog_prompt += COMMIT_LAW;
dog_prompt += "OWN: src/extract/extract.ts.tether (if extract.ts exists), src/facts.tether or ";
dog_prompt += "src/facts/lint.ts.tether, and inline @tether comments on exported IR types you did not comment.\n";
dog_prompt += "Do not rewrite root.tether or README.md. You may add @ref lines to AGENTS.md only if missing.\n";
dog_prompt += "TASK: Dogfood. Collocate doctrine on extract and fact modules. Keep it short. ";
dog_prompt += "If tether extract/lint already run, use them; if not, write valid .tether by the spec.\n";
dog_prompt += "Commit docs(tether): dogfood extract and facts.\n";

let dog_r = agent(dog_prompt, #{
    label: "dogfood",
    capability_mode: "all",
    output_schema: commit_schema,
});
if dog_r != () && dog_r.success && dog_r.output != () {
    questions = collect_questions(questions, dog_r.output);
}

if stop_rank < 6 {
    complete(#{ summary: "Stopped after dogfood", questions: questions });
}

// ── Review ───────────────────────────────────────────────────────────────
phase("Review");
log("Independent review dimensions");

let review_dims = [
    "structural safety: location is bind, no bind table, no homeless doctrine files in src/",
    "facts only: lint output has no severity/age/meaningful language; closed fact kinds only",
    "extract adjacency: comments inside bodies must not bind; fixtures per language",
    "goal: agents cannot prefer a stale committed architecture.md over collocated tethers",
    "multi-agent hygiene: no force-push, no wiping foreign files, commits exist for new code",
];

let rev_jobs = [];
for dim in review_dims {
    let rp = "";
    rp += REPO;
    rp += "READ-ONLY. git log, git diff, read_file, grep. Do not edit.\n";
    rp += "Review this dimension: ";
    rp += dim;
    rp += "\nAt most 8 findings {file, issue}. Empty list is valid only after you inspected the tree.\n";
    rev_jobs.push(#{
        prompt: rp,
        label: "review",
        capability_mode: "read-only",
        output_schema: findings_schema,
    });
}

let rev_results = parallel(rev_jobs);
let findings = [];
for rr in rev_results {
    if rr != () && rr.success && rr.output != () && rr.output.findings != () {
        for f in rr.output.findings {
            if findings.len() < 24 { findings.push(f); }
        }
    }
}
log(findings.len().to_string() + " review findings before verify");

if stop_rank < 7 {
    complete(#{ summary: "Stopped after review", finding_count: findings.len(), questions: questions });
}

// ── Verify ───────────────────────────────────────────────────────────────
phase("Verify");
log("Adversarial verification of review findings");

let confirmed = [];
if findings.len() > 0 {
    let vjobs = [];
    for f in findings {
        let vp = "";
        vp += "Repo /Users/guilhermecastro/Projects/tether. READ-ONLY. Independently read the file.\n";
        vp += "Finding: ";
        vp += f.issue;
        vp += " in ";
        vp += f.file;
        vp += "\nSet real=true only with evidence you inspected. Default real=false if unsure.\n";
        vjobs.push(#{
            prompt: vp,
            label: "verify",
            capability_mode: "read-only",
            output_schema: verdict_schema,
        });
    }
    let verdicts = parallel(vjobs);
    let vi = 0;
    for v in verdicts {
        if v != () && v.success && v.output != () && v.output.real == true
            && v.output.evidence != () && v.output.evidence != "" {
            confirmed.push(findings[vi]);
        }
        vi += 1;
    }
}
log(confirmed.len().to_string() + "/" + findings.len().to_string() + " findings confirmed");

if stop_rank < 8 {
    complete(#{
        summary: "Stopped after verify",
        confirmed: confirmed.len(),
        questions: questions,
    });
}

// ── Goal ─────────────────────────────────────────────────────────────────
phase("Goal");
log("Alignment with the original stale-docs problem");

let goal_prompt = "";
goal_prompt += REPO;
goal_prompt += "READ-ONLY. Re-read README.md (The problem) and root.tether invariants.\n";
goal_prompt += "Original goal: homeless markdown poisons agents; tether makes unattested drift a fact ";
goal_prompt += "by collocation + git + AST; no bind-table hole; facts not judgments; wiki derived.\n";
goal_prompt += "Inspect what actually shipped (src/, commands, tests). ";
goal_prompt += "aligned=true only if a user can extract+lint a @tether comment and a sidecar today.\n";
goal_prompt += "List gaps. Escalate operator questions. Do not edit.\n";

let goal_r = agent(goal_prompt, #{
    label: "goal-align",
    capability_mode: "read-only",
    output_schema: align_schema,
});
if goal_r != () && goal_r.success && goal_r.output != () {
    questions = collect_questions(questions, goal_r.output);
}

if stop_rank < 9 {
    let gsum = "Stopped after goal";
    if goal_r != () && goal_r.success && goal_r.output.summary != () {
        gsum = goal_r.output.summary;
    }
    complete(#{ summary: gsum, questions: questions, confirmed: confirmed.len() });
}

// ── Skill ────────────────────────────────────────────────────────────────
phase("Skill");
log("Refresh the tether skill from shipped behavior");

let skill_prompt = "";
skill_prompt += REPO;
skill_prompt += COMMIT_LAW;
skill_prompt += "OWN: skills/tether/SKILL.md only. Update it to match shipped CLI flags, fact names, ";
skill_prompt += "and file conventions. Keep the problem statement, do/don't, vs rogue markdown, multi-agent rule.\n";
skill_prompt += "If the CLI is still incomplete, say what is not implemented yet. Do not invent commands.\n";
skill_prompt += "Commit docs(skill): refresh tether skill from shipped CLI.\n";

let skill_r = agent(skill_prompt, #{
    label: "skill",
    capability_mode: "all",
    output_schema: commit_schema,
});
if skill_r != () && skill_r.success && skill_r.output != () {
    questions = collect_questions(questions, skill_r.output);
}

let report = "";
report += "# build-tether result\n\n";
report += "Confirmed review findings: ";
report += confirmed.len().to_string();
report += " / ";
report += findings.len().to_string();
report += "\n\nOperator questions:\n";
if questions.len() == 0 {
    report += "(none collected)\n";
} else {
    for q in questions {
        report += "- ";
        report += q;
        report += "\n";
    }
}

let report_path = write_scratch_file("build-tether-report.md", report);

complete(#{
    summary: "build-tether finished",
    report: report_path,
    confirmed_findings: confirmed.len(),
    review_findings: findings.len(),
    questions: questions,
});
