# Versioning Policy

ATE is pre-production. Prompt 1 uses:

```text
0.1.0-foundation.1
```

## Principles

- Do not represent ATE as production `1.0`.
- Versioned releases should correspond to meaningful checkpoints, not every trivial edit.
- Prompt completion should update the capability manifest and prompt ledger.
- Database migrations, when introduced, must be version-controlled and tied to application
  compatibility.
- Breaking contract changes must be documented and migrated safely.

## Relationship to prompts

Prompts are development governance checkpoints. They may update pre-production versions when they
establish meaningful capabilities.

## Git tags/releases

Prompt 1 does not create a release tag. Future releases should be deliberate, reviewed, and
documented.
