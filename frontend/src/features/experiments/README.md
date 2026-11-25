# experiments

Open **Set up experiment** from the project sidebar or Project details, or use
`/projects/:projectId/experiments/new`. Choose a saved Python source,
select target functions from the server's revision metadata, then enter
model identifiers, L1–L5 strategy IDs and a positive repeat count.

The preview calculates functions × distinct models × strategies × repeats
and limits each configuration to 1,000 planned runs. Save draft keeps
the selected source ID and revision, function names and lines, model and
strategy IDs, and repeats in this browser tab. The wizard uses the
existing sources API and contains no API key or prompt template fields.
Server-side experiment snapshots and execution are outside this wizard.
