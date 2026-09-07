alter table challenges drop constraint if exists challenges_status_check;

update challenges set status = case status
  when 'Open' then 'Published'
  when 'Submitted' then 'In progress'
  when 'Resolved' then 'Implemented'
  when 'Denied' then 'Rejected'
  else status
end;

update challenge_status_history set from_status = case from_status
  when 'Open' then 'Published'
  when 'Submitted' then 'In progress'
  when 'Resolved' then 'Implemented'
  when 'Denied' then 'Rejected'
  else from_status
end;

update challenge_status_history set to_status = case to_status
  when 'Open' then 'Published'
  when 'Submitted' then 'In progress'
  when 'Resolved' then 'Implemented'
  when 'Denied' then 'Rejected'
  else to_status
end;

alter table challenges add constraint challenges_status_check
  check (status in ('Under review', 'Published', 'In progress', 'Implemented', 'Rejected'));
