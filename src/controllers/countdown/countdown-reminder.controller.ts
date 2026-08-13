import { NextFunction, Request, Response } from "express";
import { CountdownRemindersService } from "../../services/countdown/countdown-reminders.service";

/**
 * Manual trigger for the reminder batch — superAdmin only (the route gates it
 * too). The scheduler runs once per weekday at 08:00 Buenos Aires, which is not
 * a thing QA or support can wait for.
 *
 * It goes through `runDailyOnce()` on purpose, so the manual run obeys the same
 * daily claim as the scheduler: calling it twice in one day cannot double-mail
 * anybody, and the second call reports `claimed: false`.
 */
export class CountdownReminderController {
  private _remindersService: CountdownRemindersService =
    new CountdownRemindersService();

  public async runNow(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const outcome = await this._remindersService.runDailyOnce();
      res.status(200).json({
        success: true,
        // null means today was already claimed — not an error, the expected
        // answer for every call after the first one that day.
        data: { claimed: outcome !== null, outcome },
      });
    } catch (err) {
      next(err);
    }
  }
}
