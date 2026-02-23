import type { AlertChannel, AlertEvent, OpenAlertsLogger } from "./types.js";
import { formatAlertMessage as formatAlert } from "./formatter.js";

export class AlertDispatcher {
  private channels: AlertChannel[];
  private logger: OpenAlertsLogger;
  private diagnosisHint: string;

  constructor(opts: { channels?: AlertChannel[]; logger?: OpenAlertsLogger; diagnosisHint?: string }) {
    this.channels = opts.channels ? [...opts.channels] : [];
    this.logger = opts.logger ?? console;
    this.diagnosisHint = opts.diagnosisHint ?? "";
  }

  addChannel(channel: AlertChannel): void {
    this.channels.push(channel);
  }

  get hasChannels(): boolean { return this.channels.length > 0; }
  get channelCount(): number { return this.channels.length; }

  async dispatch(alert: AlertEvent): Promise<void> {
    if (this.channels.length === 0) return;
    const formatted = formatAlert(alert, { diagnosisHint: this.diagnosisHint });
    await Promise.allSettled(
      this.channels.map(ch =>
        Promise.resolve(ch.send(alert, formatted)).catch(err =>
          this.logger.warn(`[channel:${ch.name}] send failed: ${String(err)}`)
        )
      )
    );
  }
}
