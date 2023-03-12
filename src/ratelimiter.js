const { RATE_LIMIT_MAX_DATE_TRACKING, RATE_LIMIT_DURATION_MILLISECONDS, RATE_LIMIT_COUNT } = require("../constants");

class RateLimiter {
    constructor() {
        this.ipMap = new Map();
        this.dateCount = 0;
    }

    addDateForIp(ipAddr) {
        if (this.ipMap.has(ipAddr)) {
            const list = this.ipMap.get(ipAddr);
            list.push(new Date());
            this.ipMap.set(ipAddr, list);
        } else {
            this.ipMap.set(ipAddr, [new Date()]);
        }

        this.dateCount++;
    }

    isRateExceededForIp(ipAddr) {
        if (this.dateCount > RATE_LIMIT_MAX_DATE_TRACKING) {
            for (let [key, value] of this.ipMap) {
                value.shift();
                this.dateCount--;
            }
        }

        const list = this.ipMap.get(ipAddr);

        if (list.length > 2) {
            const last = list[list.length - 1];

            for (let i = 0; i < list.length - 2; ++i) {
                const diffMillis = last - list[i];

                if (diffMillis > RATE_LIMIT_DURATION_MILLISECONDS) {
                    list.splice(i, 1);
                    i--;
                    this.dateCount--;
                }
            }

            if (list.length > RATE_LIMIT_COUNT) {
                return true;
            }
        }

        return false;
    }
}

module.exports = RateLimiter;
