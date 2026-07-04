# N6 — segnali apprendista
totale=14 processed=true=0 processed=false=14
  nudge_accepted         processed=false count=2
  task_avoided           processed=false count=2
  task_blocked           processed=false count=1
  task_postponed         processed=false count=3
  task_completed         processed=false count=5
  emotional_offload      processed=false count=1

# N5 — completamento via chat
tools=["get_today_tasks","complete_task"] taskStatus=completed task_completed signals: before=0 after=0

# N18 — Streak/UserPattern
Streak rows (coorte68)=0; Streak rows (TUTTO il DB dev)=0
UserPattern rows (coorte68)=39
UserPattern con updatedAt!=createdAt: 0/39
UserPattern con contatori non-default (>0 o lastActiveDate!=''): 0/39

# N7 — prioritizeTaskAdaptive dead code
daily-plan/route.ts usa prioritizeTask (NON adaptive) alla riga 91; nessun caller di prioritizeTaskAdaptive in src/ (verificato via Grep).