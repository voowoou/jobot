import { logEvent } from "./logger.js";

const REPORT_EVERY = 100;

export class ProcessingMetrics {
	private count = 0;
	private metadataMs = 0;
	private filterMs = 0;
	private matchingMs = 0;
	private storageMs = 0;

	public record(timing: {
		metadataMs: number;
		filterMs: number;
		matchingMs: number;
		storageMs: number;
	}): void {
		this.count += 1;
		this.metadataMs += timing.metadataMs;
		this.filterMs += timing.filterMs;
		this.matchingMs += timing.matchingMs;
		this.storageMs += timing.storageMs;
		if (this.count % REPORT_EVERY !== 0) return;
		logEvent("info", "message.processing_metrics", {
			messages: this.count,
			metadataAvgMs: Math.round(this.metadataMs / this.count),
			filterAvgMs: Math.round(this.filterMs / this.count),
			matchingAvgMs: Math.round(this.matchingMs / this.count),
			storageAvgMs: Math.round(this.storageMs / this.count),
		});
	}
}
