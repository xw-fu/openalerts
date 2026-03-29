import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAlertMessage } from "../formatter.js";
import type { AlertEvent } from "../types.js";

function makeAlert(overrides: Partial<AlertEvent> = {}): AlertEvent {
	return {
		type: "alert",
		id: "test:1",
		ruleId: "test-rule",
		severity: "error",
		title: "Test alert",
		detail: "Something went wrong.",
		ts: Date.now(),
		fingerprint: "test:fp",
		...overrides,
	};
}

describe("formatAlertMessage", () => {
	it("should use RECOVERED prefix for recovery alerts", () => {
		const alert = makeAlert({ recovery: true, severity: "info" });
		const msg = formatAlertMessage(alert);
		assert.ok(msg.startsWith("[OpenAlerts] RECOVERED:"), `Got: ${msg}`);
	});

	it("should use CRITICAL prefix for critical alerts", () => {
		const alert = makeAlert({ severity: "critical" });
		const msg = formatAlertMessage(alert);
		assert.ok(msg.startsWith("[OpenAlerts] CRITICAL:"), `Got: ${msg}`);
	});

	it("should use plain prefix for error alerts", () => {
		const alert = makeAlert({ severity: "error" });
		const msg = formatAlertMessage(alert);
		assert.ok(msg.startsWith("[OpenAlerts] "), `Got: ${msg}`);
		assert.ok(!msg.startsWith("[OpenAlerts] CRITICAL:"), `Got: ${msg}`);
		assert.ok(!msg.startsWith("[OpenAlerts] RECOVERED:"), `Got: ${msg}`);
	});

	it("should append /health hint for normal alerts", () => {
		const alert = makeAlert({ severity: "warn" });
		const msg = formatAlertMessage(alert);
		assert.ok(msg.includes("/health for full status."), `Got: ${msg}`);
	});

	it("should append diagnosis hint for critical alerts", () => {
		const alert = makeAlert({ severity: "critical" });
		const hint = 'Run "openclaw doctor" for diagnosis.';
		const msg = formatAlertMessage(alert, { diagnosisHint: hint });
		assert.ok(msg.includes(hint), `Got: ${msg}`);
		assert.ok(!msg.includes("/health for full status."), `Got: ${msg}`);
	});

	it("should not use diagnosis hint for recovery alerts", () => {
		const alert = makeAlert({ recovery: true, severity: "critical" });
		const hint = 'Run "openclaw doctor"';
		const msg = formatAlertMessage(alert, { diagnosisHint: hint });
		assert.ok(msg.includes("/health for full status."), `Got: ${msg}`);
		assert.ok(!msg.includes(hint), `Got: ${msg}`);
	});

	it("should include title and detail in message", () => {
		const alert = makeAlert({
			title: "Gateway unresponsive",
			detail: "No heartbeat for 45s.",
		});
		const msg = formatAlertMessage(alert);
		assert.ok(msg.includes("Gateway unresponsive"), `Got: ${msg}`);
		assert.ok(msg.includes("No heartbeat for 45s."), `Got: ${msg}`);
	});
});
