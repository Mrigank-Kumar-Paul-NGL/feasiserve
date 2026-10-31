-- Stage 2.7: allow the static-directory locator task. Constraint change only; no data touched.
alter table investigation_runs drop constraint investigation_runs_operation_check;
alter table investigation_runs add constraint investigation_runs_operation_check
  check (operation in ('search_official', 'search_community', 'fetch_official', 'locator_agent', 'locator_directory'));
