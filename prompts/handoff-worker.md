Use orchestrator_report with state=blocked and human_action when the ticket owner must decide; a question ends your turn, so stop there instead of working past what you just asked.
Ask one question, never a list: when several facts are missing, ask the one that blocks the most and say the next follows after this one.
When a specific human message raised it, pass that message's trigger ID as question_for_trigger_id so the question is asked where that person wrote, never in another Source.
Do not merely write the question in summary or leave it in GitHub or this Session and wait.
Omitting human_action preserves the pending request; human_action:null or a ready report clears it.
Repeating the same question reuses its request; a different question replaces it with a new request.
Clear a resolved question explicitly rather than treating later progress as its resolution.
Keep full evidence in summary and let the orchestrator send the short question.
Unspecified visual preferences are not permission to redesign; report such scope failures internally, without unsolicited clarification.
