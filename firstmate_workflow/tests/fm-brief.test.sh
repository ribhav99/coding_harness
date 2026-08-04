#!/usr/bin/env bash
# Behavior tests for bin/fm-brief.sh.
#
# Regression coverage for the heredoc-in-command-substitution parse bug (issues
# #166, #958, #1069). Building a variable with `VAR=$(cat <<EOF ... EOF)` is
# unsafe on Bash 3.2 (macOS /bin/bash): the lexer scans for the matching `)` of
# the command substitution textually and tracks quote state through the heredoc
# body, so a single apostrophe, unbalanced quote, or unbalanced paren anywhere
# in that body breaks parsing of the *entire rest of the script* - `bash -n`
# fails, not just the generated brief. The DOD and Herdr-section builders now
# use `IFS= read -r -d '' VAR <<EOF || true` instead, which removes the `$(...)`
# wrapper and eliminates the whole defect class regardless of future prose.
# test_no_heredoc_in_command_substitution guards that structure directly.
# Ambient `bash -n` here is Bash 5 and cannot see the bug, so the real
# cross-version enforcement lives in the macos-stock-bash CI job.
set -u

# shellcheck source=tests/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TMP_ROOT=$(fm_test_tmproot fm-brief)
BRIEF_HOME="$TMP_ROOT/home"
mkdir -p "$BRIEF_HOME/data"

# The script itself must always parse under the ambient bash. That is Bash 5 in
# CI and locally, where the issue #958/#1069 parser bug does not fire, so this
# is a weak guard on its own; test_no_heredoc_in_command_substitution and the
# macos-stock-bash CI job carry the real cross-version enforcement.
test_script_parses() {
  local out rc
  out=$(bash -n "$ROOT/bin/fm-brief.sh" 2>&1); rc=$?
  expect_code 0 "$rc" "bash -n bin/fm-brief.sh must parse cleanly (got: $out)"
  [ -z "$out" ] || fail "bash -n bin/fm-brief.sh emitted unexpected output: $out"
  pass "fm-brief.sh: bash -n succeeds"
}

# Structural class guard (issues #166, #958, #1069): never build a variable by
# wrapping a heredoc in a command substitution (`VAR=$(cat <<EOF ... EOF)`).
# That construct is what breaks Bash 3.2 parsing, and pinning one historical
# apostrophe phrase (as the old test did) missed the #945 reintroduction. This
# guards the *shape* directly against the whole file, so any future DOD or
# section builder that reintroduces the class fails here regardless of prose.
test_no_heredoc_in_command_substitution() {
  local unsafe safe
  unsafe="$TMP_ROOT/heredoc-in-substitution.sh"
  safe="$TMP_ROOT/plain-heredoc.sh"
  # shellcheck disable=SC2016 # Literal shell fixtures must remain unexpanded.
  printf '%s\n' 'value=$(' '  cat <<EOF' 'body' 'EOF' ')' > "$unsafe"
  # shellcheck disable=SC2016 # Literal shell fixtures must remain unexpanded.
  printf '%s\n' 'cat <<EOF' '$(' '  cat <<INNER' 'INNER' ')' 'EOF' > "$safe"
  if no_heredoc_in_command_substitution "$unsafe"; then
    fail "structural guard accepted a multiline heredoc nested in a command substitution"
  fi
  no_heredoc_in_command_substitution "$safe" \
    || fail "structural guard treated heredoc body prose as shell structure"
  no_heredoc_in_command_substitution "$ROOT/bin/fm-brief.sh" \
    || fail "fm-brief.sh wraps a heredoc in a command substitution (breaks Bash 3.2 parsing)"
  pass "fm-brief.sh: no heredoc is nested inside a command substitution (Bash 3.2 parse-safe)"
}

no_heredoc_in_command_substitution() {
  perl - "$1" <<'PERL'
use strict;
use warnings;

my $path = shift;
open my $source, '<', $path or die "$path: $!\n";
my @frames;
my @heredocs;
my $quote = '';
my $line_number = 0;

while (my $line = <$source>) {
  $line_number++;
  if (@heredocs) {
    my $candidate = $line;
    $candidate =~ s/\r?\n\z//;
    $candidate =~ s/^\t+// if $heredocs[0]{strip_tabs};
    shift @heredocs if $candidate eq $heredocs[0]{delimiter};
    next;
  }

  my $length = length $line;
  for (my $i = 0; $i < $length; $i++) {
    my $char = substr($line, $i, 1);
    if ($quote eq "'") {
      $quote = '' if $char eq "'";
      next;
    }
    if ($char eq '\\') {
      $i++;
      next;
    }
    if ($quote eq '"' && $char eq '"') {
      $quote = '';
      next;
    }
    if ($char eq "'" && $quote eq '') {
      $quote = "'";
      next;
    }
    if ($char eq '"' && $quote eq '') {
      $quote = '"';
      next;
    }
    if ($char eq '#' && $quote eq '' && ($i == 0 || substr($line, $i - 1, 1) =~ /[\s;|&()]/)) {
      last;
    }
    if ($char eq '$' && substr($line, $i + 1, 1) eq '(') {
      push @frames, { depth => 1, quote => $quote };
      $quote = '';
      $i++;
      next;
    }
    if (@frames && $quote eq '' && $char eq '(') {
      $frames[-1]{depth}++;
      next;
    }
    if (@frames && $quote eq '' && $char eq ')') {
      $frames[-1]{depth}--;
      if ($frames[-1]{depth} == 0) {
        my $frame = pop @frames;
        $quote = $frame->{quote};
      }
      next;
    }
    next unless $quote eq '' && $char eq '<' && substr($line, $i + 1, 1) eq '<';
    if (@frames) {
      print STDERR "$path:$line_number\n";
      exit 1;
    }

    my $j = $i + 2;
    my $strip_tabs = substr($line, $j, 1) eq '-';
    $j++ if $strip_tabs;
    $j++ while substr($line, $j, 1) =~ /[ \t]/;
    my $delimiter = '';
    my $delimiter_quote = '';
    for (; $j < $length; $j++) {
      my $token = substr($line, $j, 1);
      if ($delimiter_quote) {
        if ($token eq $delimiter_quote) {
          $delimiter_quote = '';
        } elsif ($token eq '\\' && $delimiter_quote eq '"') {
          $j++;
          $delimiter .= substr($line, $j, 1);
        } else {
          $delimiter .= $token;
        }
        next;
      }
      if ($token eq "'" || $token eq '"') {
        $delimiter_quote = $token;
        next;
      }
      if ($token eq '\\') {
        $j++;
        $delimiter .= substr($line, $j, 1);
        next;
      }
      last if $token =~ /[\s;|&()<>]/;
      $delimiter .= $token;
    }
    push @heredocs, { delimiter => $delimiter, strip_tabs => $strip_tabs };
    $i = $j - 1;
  }
}

exit 0;
PERL
}

test_help_includes_entire_header() {
  local help
  help=$("$ROOT/bin/fm-brief.sh" --help)
  assert_contains "$help" "Refuses to overwrite an existing brief." "fm-brief.sh --help omitted its header terminator"
  pass "fm-brief.sh: --help renders the complete header"
}

# Registry with one project per delivery mode, so each ship-mode DOD branch is
# exercised. A project absent from the registry defaults to no-mistakes.
write_registry() {
  local home=$1
  mkdir -p "$home/data"
  cat > "$home/data/projects.md" <<'EOF'
- direct-proj [direct-PR] - fixture for direct-PR mode (added 2026-07-01)
- local-proj [local-only] - fixture for local-only mode (added 2026-07-01)
EOF
}

# A ship brief carries ONE instruction: the work item to read and implement.
# Firstmate never restates the task, so both source variants must name the item,
# tell the worker how to read it, and close with the commit/push/PR path plus the
# terminal status append that is firstmate's only completion signal.
test_ship_brief_carries_one_instruction() {
  local home brief status
  home="$TMP_ROOT/ship-home"
  write_registry "$home"

  FM_HOME="$home" "$ROOT/bin/fm-brief.sh" ship-issue-a1 direct-proj --issue 42 >/dev/null 2>&1; status=$?
  expect_code 0 "$status" "fm-brief.sh --issue should exit 0"
  brief="$home/data/ship-issue-a1/brief.md"
  assert_present "$brief" "issue ship brief was not scaffolded"
  assert_grep "Implement GitHub issue #42 in direct-proj." "$brief" \
    "issue brief did not name the work item"
  # shellcheck disable=SC2016  # single quotes are deliberate: the backticks must stay literal
  assert_grep '`gh issue view 42`' "$brief" \
    "issue brief did not tell the worker how to read the issue"

  FM_HOME="$home" "$ROOT/bin/fm-brief.sh" ship-wo-a2 direct-proj --work-order wo-add-signin >/dev/null 2>&1; status=$?
  expect_code 0 "$status" "fm-brief.sh --work-order should exit 0"
  brief="$home/data/ship-wo-a2/brief.md"
  assert_present "$brief" "work-order ship brief was not scaffolded"
  assert_grep "Implement Software Factory work order wo-add-signin in direct-proj." "$brief" \
    "work-order brief did not name the work item"
  assert_grep "Read this work order on Software Factory." "$brief" \
    "work-order brief did not send the worker to Software Factory"
  assert_no_grep "work-orders/" "$brief" \
    "work-order brief re-added a path the worker does not need"

  for brief in "$home/data/ship-issue-a1/brief.md" "$home/data/ship-wo-a2/brief.md"; do
    assert_grep "commit, push that branch, and open a PR" "$brief" \
      "$brief: ship brief lost the commit/push/PR close-out"
    # shellcheck disable=SC2016  # single quotes are deliberate: the backticks must stay literal
    assert_grep 'echo "done: PR {url}" >>' "$brief" \
      "$brief: ship brief lost the terminal completion signal firstmate reads"
    # A worker must stop on a real ambiguity rather than guess and ship it.
    # shellcheck disable=SC2016  # single quotes are deliberate: the backticks must stay literal
    assert_grep 'echo "needs-decision: {the options}" >>' "$brief" \
      "$brief: ship brief lost the escalation path for an ambiguous decision"
    assert_grep "STOP and wait for the answer rather than guessing" "$brief" \
      "$brief: ship brief let the worker continue past an ambiguous decision"
    assert_no_grep "EOF" "$brief" "$brief: leaked a heredoc EOF marker (unterminated heredoc)"
    # Firstmate no longer writes task prose, and the scaffold must not reintroduce
    # instructions for tooling this delivery path does not use.
    assert_no_grep "{TASK}" "$brief" "$brief: ship brief reintroduced a task placeholder"
    assert_no_grep "gh-axi" "$brief" "$brief: ship brief reintroduced gh-axi"
    assert_no_grep "no-mistakes" "$brief" "$brief: ship brief reintroduced no-mistakes"
    assert_no_grep "Herdr" "$brief" "$brief: ship brief reintroduced the Herdr declaration"
    assert_no_grep "Verify isolation before anything else" "$brief" \
      "$brief: ship brief restated isolation that fm-spawn.sh already enforces"
  done
  pass "fm-brief.sh: ship briefs carry one work-item instruction and the PR close-out"
}

# The source flag is how firstmate tells the worker which tracker the project
# uses, so an absent, doubled, or malformed flag must fail rather than guess.
test_ship_brief_requires_exactly_one_valid_source() {
  local home status
  home="$TMP_ROOT/ship-source-home"
  write_registry "$home"

  FM_HOME="$home" "$ROOT/bin/fm-brief.sh" src-none direct-proj >/dev/null 2>&1; status=$?
  expect_code 1 "$status" "a ship brief with no source flag must fail"
  assert_absent "$home/data/src-none/brief.md" "sourceless ship brief still wrote a file"

  FM_HOME="$home" "$ROOT/bin/fm-brief.sh" src-both direct-proj --issue 5 --work-order wo-x >/dev/null 2>&1; status=$?
  expect_code 1 "$status" "--issue combined with --work-order must fail"

  FM_HOME="$home" "$ROOT/bin/fm-brief.sh" src-bad direct-proj --issue not-a-number >/dev/null 2>&1; status=$?
  expect_code 1 "$status" "a non-numeric --issue must fail"

  FM_HOME="$home" "$ROOT/bin/fm-brief.sh" src-empty direct-proj --issue >/dev/null 2>&1; status=$?
  expect_code 1 "$status" "--issue with no value must fail"

  FM_HOME="$home" "$ROOT/bin/fm-brief.sh" src-scout direct-proj --scout --issue 5 >/dev/null 2>&1; status=$?
  expect_code 1 "$status" "a source flag on a scout brief must fail"

  pass "fm-brief.sh: ship briefs require exactly one valid work-item source"
}

# The single-shaped ship brief tells the worker to push and open a PR, which a
# local-only project forbids, so the scaffold refuses instead of misinstructing.
test_ship_brief_refuses_non_direct_pr_mode() {
  local home status err
  home="$TMP_ROOT/ship-mode-home"
  write_registry "$home"
  err="$TMP_ROOT/ship-mode.err"

  FM_HOME="$home" "$ROOT/bin/fm-brief.sh" mode-local local-proj --issue 9 >/dev/null 2>"$err"; status=$?
  expect_code 1 "$status" "a local-only ship brief must be refused"
  assert_grep "ship briefs are direct-PR only" "$err" \
    "local-only refusal did not name the reason"
  assert_absent "$home/data/mode-local/brief.md" "refused ship brief still wrote a file"
  if [ -d "$home/data/mode-local" ]; then
    fail "refused ship brief left an empty task directory behind"
  fi

  # An unregistered project falls back to direct-PR in this fork, so it still ships.
  FM_HOME="$home" "$ROOT/bin/fm-brief.sh" mode-unreg unregistered-proj --issue 9 >/dev/null 2>&1; status=$?
  expect_code 0 "$status" "an unregistered project should fall back to direct-PR and scaffold"

  pass "fm-brief.sh: ship briefs refuse a delivery mode that forbids push and PR"
}








# Ship briefs carry only a terminal `done:` append, so the pause/blocked
# vocabulary applies to the scaffolds that keep the full status protocol.
test_pause_verb_override_renders_in_status_scaffolds() {
  local home kind id brief
  home="$TMP_ROOT/pause-verb-home"
  mkdir -p "$home/data"

  kind=scout
  id="brief-pause-verb-$kind"
  FM_HOME="$home" FM_CLASSIFY_PAUSED_VERB=awaiting \
    "$ROOT/bin/fm-brief.sh" "$id" firstmate --scout >/dev/null 2>&1
  brief="$home/data/$id/brief.md"
  assert_grep "States: working, needs-decision, blocked, awaiting, done, failed." "$brief" \
    "$kind brief did not render the configured pause verb in its states list"
  # shellcheck disable=SC2016 # Literal backticks and braces must remain unexpanded.
  assert_grep 'Use `awaiting: {why}`' "$brief" \
    "$kind brief did not instruct the configured pause status"
  # shellcheck disable=SC2016 # Literal backticks and braces must remain unexpanded.
  assert_no_grep '`paused: {why}`' "$brief" \
    "$kind brief still instructs the default paused status"
  assert_grep 'or a blocker clears' "$brief" \
    "$kind brief did not require durable resolution when a blocker clears"
  pass "fm-brief.sh: custom pause verb renders in the scout scaffold"
}

test_scout_loads_decision_hold_policy() {
  local home scout
  home="$TMP_ROOT/decision-policy-home"
  mkdir -p "$home/data"
  FM_HOME="$home" FM_ROOT_OVERRIDE="$ROOT" \
    "$ROOT/bin/fm-brief.sh" sample-investigation sample --scout >/dev/null 2>&1
  scout="$home/data/sample-investigation/brief.md"
  assert_grep "$ROOT/.agents/skills/decision-hold-lifecycle/SKILL.md" "$scout" \
    "scout brief did not load the unresolved-decision policy before done"
  assert_grep "pass its shared completion gate for the report and any visual review" "$scout" \
    "scout brief did not cross-reference visual-review completion"
  pass "fm-brief.sh: investigation and visual-review completions load the shared decision policy"
}

# The scout path still scaffolds a well-formed brief.
test_scout_scaffold() {
  local brief
  FM_HOME="$BRIEF_HOME" "$ROOT/bin/fm-brief.sh" brief-scout-q6 alpha --scout >/dev/null 2>&1 \
    || fail "fm-brief.sh scout scaffold exited non-zero"
  brief="$BRIEF_HOME/data/brief-scout-q6/brief.md"
  assert_present "$brief" "scout brief was not scaffolded"
  assert_grep "SCOUT task" "$brief" "scout brief must declare itself a scout task"
  assert_grep "report.md" "$brief" "scout brief must point at the report deliverable"

  pass "fm-brief: the scout code path still scaffolds a well-formed brief"
}

test_script_parses
test_no_heredoc_in_command_substitution
test_help_includes_entire_header
test_ship_brief_carries_one_instruction
test_ship_brief_requires_exactly_one_valid_source
test_ship_brief_refuses_non_direct_pr_mode
test_pause_verb_override_renders_in_status_scaffolds
test_scout_loads_decision_hold_policy
test_scout_scaffold
