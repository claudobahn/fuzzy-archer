let maxOpacity = 255 * 0.55;
function loadGauges() {
    let gaugePanel = document.getElementById("gaugePanel");
    if (gaugePanel !== null && gaugePanel !== undefined && window.getComputedStyle(gaugePanel).display === 'none') {
        gaugePanel.remove();
        document.getElementById("mainPanel").setAttribute("class", "col-12 mt-1");
        return;
    }
    for (let gaugeId of Object.keys(weewxData.gauges)) {
        let documentGaugeId = gaugeId + "Gauge";

        if (gauges[documentGaugeId] !== undefined) {
            // Clear any spliceWindRose timer attached to this gauge before we
            // dispose -- ECharts disposes the chart but our setInterval would
            // keep firing setOption against a defunct instance and throwing.
            if (gauges[documentGaugeId].windRoseTimer !== undefined) {
                clearInterval(gauges[documentGaugeId].windRoseTimer);
            }
            gauges[documentGaugeId].dispose();
            gauges[documentGaugeId] = undefined;
        }

        let gaugeElement = document.getElementById(documentGaugeId);
        if (gaugeElement === null || gaugeElement === undefined) {
            continue;
        }
        let gauge = echarts.init(gaugeElement, null, {
            locale: eChartsLocale
        });
        gauge.weewxData = weewxData.gauges[gaugeId];
        gauge.weewxData.observationType = gaugeId;
        gauge.weewxData.dataset = {
            weewxColumn: gaugeId
        };
        gauge.weewxData.dataset.data = aggregate(JSON.parse(JSON.stringify(weewxData[gaugeId])), gauge.weewxData.aggregateInterval, gauge.weewxData.aggregateType, gauge.weewxData.decimals);
        gauges[documentGaugeId] = gauge;
        let colors = [];
        let gaugePitchPrecision = gauge.weewxData["gauge_pitch_precision"] === undefined ? 1 : gauge.weewxData["gauge_pitch_precision"];
        let minvalue = gauge.weewxData.minvalue;
        let maxvalue = gauge.weewxData.maxvalue;
        let splitnumber = gauge.weewxData.splitnumber;
        let gaugeName = gauge.weewxData.gaugeName === undefined ? weewxData.labels.Generic[gaugeId] : gauge.weewxData.gaugeName;
        let axisTickSplitNumber = 5;
        gauge.weewxData.heatMapEnabled = parseBooleanDefaultTrue(gauge.weewxData.heatMapEnabled);
        gauge.weewxData.stuckNeedleEnabled = parseBooleanDefaultTrue(gauge.weewxData.stuckNeedleEnabled);
        gauge.weewxData.axisLineEnabled = parseBooleanDefaultTrue(gauge.weewxData.axisLineEnabled);
        gauge.weewxData.windRoseEnabled = parseBooleanDefaultFalse(gauge.weewxData.windRoseEnabled);
        if (gauge.weewxData.obs_group === "group_direction") {
            minvalue = 0;
            maxvalue = 360;
            splitnumber = 4;
            axisTickSplitNumber = 4;
            colors = [[0.25, gauge.weewxData.lineColorN], [0.5, gauge.weewxData.lineColorS], [0.75, gauge.weewxData.lineColorS], [1, gauge.weewxData.lineColorN]];
            gauge.weewxData.directionValuesEnabled = parseBooleanDefaultFalse(gauge.weewxData.directionValuesEnabled);
        } else {
            let lineColors = Array.isArray(gauge.weewxData.lineColor) ? gauge.weewxData.lineColor : [gauge.weewxData.lineColor];
            let lineColorUntilValues = Array.isArray(gauge.weewxData.lineColorUntil) ? gauge.weewxData.lineColorUntil : [gauge.weewxData.lineColorUntil];
            let range = maxvalue - minvalue;
            for (let i = 0; i < lineColors.length; i++) {
                let untilValue = lineColorUntilValues[i].toLowerCase();
                if (isNaN(untilValue)) {
                    if (untilValue === 'maxvalue') {
                        untilValue = maxvalue;
                    } else if (untilValue === 'minvalue') {
                        untilValue = minvalue;
                    } else {
                        console.log("Invalid value: " + untilValue);
                        untilValue = maxvalue;
                    }
                } else {
                    untilValue = untilValue;
                }
                colors.push([(untilValue - minvalue) / range, lineColors[i]]);
            }
        }
        let gaugeOption = getGaugeOption(gaugeName, minvalue, maxvalue, splitnumber, axisTickSplitNumber, colors, weewxData.units.Labels[gauge.weewxData.target_unit], gauge.weewxData);
        if (gauge.weewxData.obs_group === "group_direction") {
            gauge.isCircular = true;
            gaugeOption.series[0].startAngle = 90;
            gaugeOption.series[0].endAngle = -270;
            if (gaugeOption.series[1] !== undefined) {
                gaugeOption.series[1].startAngle = 90;
                gaugeOption.series[1].endAngle = -270;
            }
            // axisLabel.distance is measured outward from the axisLine. With
            // the line hidden (axisLineEnabled: false) the cardinal labels
            // float well outside the visible gauge; collapse the gap so they
            // sit just beyond the ticks instead.
            gaugeOption.series[0].axisLabel.distance = gauge.weewxData.axisLineEnabled ? 10 : 2;
            gaugeOption.series[0].axisLabel.fontSize = gauge.weewxData.labelFontSize === undefined ? 12 : gauge.weewxData.labelFontSize;
            gaugeOption.series[0].axisLabel.fontWeight = 'bold';
            gaugeOption.series[0].axisLabel.formatter = function (value) {
                if (value === 0)
                    return weewxData.labels.hemispheres === undefined ? "N" : weewxData.labels.hemispheres[0];
                if (value === 90)
                    return weewxData.labels.hemispheres === undefined ? "E" : weewxData.labels.hemispheres[2];
                if (value === 180)
                    return weewxData.labels.hemispheres === undefined ? "S" : weewxData.labels.hemispheres[1];
                if (value === 270)
                    return weewxData.labels.hemispheres === undefined ? "W" : weewxData.labels.hemispheres[3];
            };
            gaugeOption.series[0].title.offsetCenter = ['0', '-25%'];
            gaugeOption.series[0].detail.offsetCenter = ['0', '30%'];
            if (gauge.weewxData.directionValuesEnabled) {
                gaugeOption.series[0].detail.formatter = function (value) {
                    let ordinals = weewxData.units.Ordinates.directions === undefined ? ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW', 'N/A'] : weewxData.units.Ordinates.directions;
                    if (isNaN(value)) {
                        return ordinals[-1];
                    }
                    let sectorSize = 360.0 / ((ordinals.length) - 1);
                    let degree = (value + sectorSize / 2.0) % 360.0;
                    let sector = Math.floor(degree / sectorSize);
                    return ordinals[sector];
                };
            }
        }
        gauge.setOption(gaugeOption);

        // Optional wind-rose overlay: a stacked polar bar chart spliced into
        // the SAME ECharts instance, showing historical direction frequency
        // binned by speed. Only meaningful on direction gauges (we need both
        // a wind direction obs and a wind speed obs); opt-in via
        // windRoseEnabled. See spliceWindRose() below for the full config.
        if (gauge.weewxData.windRoseEnabled
            && gauge.weewxData.obs_group === "group_direction") {
            spliceWindRose(gauge, gaugeId);
        }
    }
}

// Splice a polar bar wind rose into a direction-gauge's ECharts instance,
// overlaid on top of the gauge arc + needle. Pairs the gauge's direction obs
// with a second (speed) obs and aggregates the recent timespan into 16
// compass sectors x N speed bins, sized as percentage-of-total samples per
// segment. Speed values are converted to the gauge-config-supplied unit via
// units.js's convert(), so the bin breakpoints/labels are written in display
// units (knot, mph, m_per_sec, ...) regardless of storage unit.
//
// Config (under the gauge subsection in skin.conf):
//   [[[<gauge>]]]              # the windDir (or other group_direction) gauge
//       payload_key = windDir
//       windRoseEnabled = true
//       [[[[windRose]]]]
//           speedObs = windSpeed         # default 'windSpeed'
//           bins     = 10, 15, 20        # upper-bound (exclusive) per speed bin;
//                                        # the last bin sweeps everything above
//                                        # the previous max (i.e. >20)
//           colors   = #5b9bd5, #ffc000, #00b050, #000000
//           labels   = Light, Medium, Heavy, No sailing
function spliceWindRose(gauge, gaugeId) {
    let rc = gauge.weewxData.windRose || {};
    // Direction obs name -- gauges.js sets observationType to the gauge id at
    // init, but explicitly named here so the source of the historical series
    // and live-payload lookup is clear (and so a gauge whose subsection name
    // diverges from the obs name can override it).
    let dirObs = gauge.weewxData.observationType || gaugeId;
    let speedObs = rc.speedObs || 'windSpeed';
    // Bin upper-bounds in target display unit. N values produce N+1 segments
    // (the last segment is "above the last value").
    let binMaxes = toFloats(rc.bins, [10, 20, 30]);
    let colors = toArray(rc.colors, ['#5b9bd5', '#5cb85c', '#ffc000', '#d9534f']);
    let labels = toArray(rc.labels, ['light', 'moderate', 'strong', 'very strong']);
    let bins = colors.map((color, i) => ({
        max: i < binMaxes.length ? binMaxes[i] : Infinity,
        color: color,
        label: labels[i] || ('bin ' + i)
    }));
    // Look up the obs's actual unit group via units.js's observationGroups
    // table rather than assuming group_speed -- a deployment using a custom
    // unit group for wind speed (rare but valid) would otherwise mis-convert.
    let speedConvCfg = {
        observationType: speedObs,
        obs_group: (typeof observationGroups !== 'undefined' && observationGroups[speedObs]) || 'group_speed'
    };

    // JSONGenerator only emits weewxData[<obs>] history for obs that are
    // referenced as a gauge or chart subsection. If either of our two obs is
    // missing, the rose can still populate from live MQTT messages but
    // historical seeding silently does nothing -- which reads as "the rose
    // doesn't work" until the user reads the report-engine log carefully.
    // One console.warn per missing obs surfaces it cheaply.
    if (weewxData[dirObs] === undefined) {
        console.warn("windRose on '" + gaugeId + "': weewxData['" + dirObs +
                     "'] missing -- direction history won't seed the rose. " +
                     "Add a gauge or chart entry for '" + dirObs +
                     "' so JSONGenerator emits it.");
    }
    if (weewxData[speedObs] === undefined) {
        console.warn("windRose on '" + gaugeId + "': weewxData['" + speedObs +
                     "'] missing -- speed history won't seed the rose. " +
                     "Add a gauge or chart entry for '" + speedObs +
                     "', or set the windRose.speedObs config to an obs you " +
                     "already render.");
    }

    let DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

    function dirBin(deg) { return Math.floor(((deg + 11.25) % 360) / 22.5); }
    function speedBin(spd) {
        for (let i = 0; i < bins.length; i++) if (spd <= bins[i].max) return i;
        return bins.length - 1;
    }

    // Find the live MQTT payload key for an obs: weewx-mqtt/publish emits keys
    // as <obs>_<unit-label> (e.g. windSpeed_mph), or bare <obs> when there's
    // no unit label (windDir). Match the bare obs first, then any suffixed form.
    function livePayloadValue(pl, obs) {
        if (pl[obs] !== undefined) return Number(pl[obs]);
        let prefix = obs + '_';
        for (let key in pl) {
            if (key.indexOf(prefix) === 0) return Number(pl[key]);
        }
        return null;
    }

    // Collect {ts, dir, spd}: historical from weewxData[dirObs]/[speedObs]
    // plus newest from liveData; clip to the dashboard's timespan window.
    // Number.isFinite filters out null/undefined AND NaN -- the latter would
    // otherwise pass a bare `!= null` check and end up binned into bins[-1]
    // or the highest-speed bin, both of which falsify the rose silently.
    function samples() {
        let dirS = weewxData[dirObs] || [];
        let spdS = weewxData[speedObs] || [];
        let map = new Map();
        dirS.forEach(p => {
            if (Number.isFinite(p[1])) map.set(p[0], { ts: p[0], dir: p[1] });
        });
        spdS.forEach(p => {
            if (!Number.isFinite(p[1])) return;
            let converted = convert(speedConvCfg, p[1]);
            if (!Number.isFinite(converted)) return;
            let e = map.get(p[0]) || { ts: p[0] };
            e.spd = converted;
            map.set(p[0], e);
        });
        (typeof liveData !== 'undefined' ? liveData : []).forEach(pair => {
            let ts = pair[0], pl = pair[1];
            let dir = livePayloadValue(pl, dirObs);
            let spd = livePayloadValue(pl, speedObs);
            if (!Number.isFinite(dir) || !Number.isFinite(spd)) return;
            let converted = convert(speedConvCfg, spd);
            if (!Number.isFinite(converted)) return;
            map.set(ts, { ts: ts, dir: dir, spd: converted });
        });
        let cutoff = Date.now() - gaugeHistoryMs(gauge.weewxData);
        let out = [];
        map.forEach(e => {
            if (e.ts >= cutoff && Number.isFinite(e.dir) && Number.isFinite(e.spd)) out.push(e);
        });
        return out;
    }

    // Aggregate samples into 16-direction x N-speed-bin counts, normalize to
    // percentage-of-total, compute the per-direction stack maxima, and round
    // to a "nice" upper bound for the radial axis so the splitLines land on
    // round percentage values.
    function aggregate() {
        let counts = []; for (let i = 0; i < 16; i++) counts.push(bins.map(() => 0));
        samples().forEach(s => { counts[dirBin(s.dir)][speedBin(s.spd)]++; });
        let total = 0; counts.forEach(d => d.forEach(c => total += c));
        let pct = counts.map(d => d.map(c => total > 0 ? (c / total * 100) : 0));
        let maxStack = Math.max(0, ...pct.map(d => d.reduce((a, b) => a + b, 0)));
        let niceMax = Math.max(5, Math.ceil(maxStack / 5) * 5);   // nearest 5, min 5
        let series = bins.map((b, idx) => ({
            id: 'windRose-' + idx,
            name: b.label, type: 'bar', coordinateSystem: 'polar', stack: 'wind',
            data: pct.map(d => d[idx]),
            itemStyle: { color: b.color },
            z: 1                                            // below gauge needle (default z 2)
        }));
        return { series, niceMax };
    }

    // Two polar systems sharing the same drawing area. Polar 0 holds the bars
    // with N at top -- its angleAxis.startAngle = 101.25 (N at 12 o'clock with
    // boundaryGap centering) drives BOTH where the first category sits AND
    // where the radius axis labels would render, leaving the % labels along
    // the vertical. Polar 1 is invisible-data and exists only so its own
    // angleAxis.startAngle (-45, the SE radial in ECharts polar coords) can
    // anchor the radius labels along the SE direction instead. Same min/max
    // on both radiusAxes keeps the labels aligned with polar 0's splitLine
    // rings.
    let opt = gauge.getOption();
    let { series, niceMax } = aggregate();
    // Outer radius depends on whether the gauge's own axisLine is visible:
    // when it is (default), stop at 70% so the bars don't crowd the 95%-radius
    // arc + its cardinal/value labels; when axisLineEnabled is false, the
    // arc is hidden so the bars can extend out to 95% (right up against
    // where the cardinal labels sit at distance 2).
    let outerR = gauge.weewxData.axisLineEnabled ? '70%' : '95%';
    gauge.setOption({
        polar: [
            { center: ['50%','50%'], radius: ['8%', outerR] },
            { center: ['50%','50%'], radius: ['8%', outerR] }
        ],
        angleAxis: [
            {
                polarIndex: 0,
                type: 'category', data: DIRS,
                boundaryGap: true, startAngle: 101.25, clockwise: true,
                axisLine: {show: false}, axisTick: {show: false}, axisLabel: {show: false}
            },
            {
                polarIndex: 1,
                type: 'value', startAngle: -45,        // SE radial in ECharts polar
                min: 0, max: 360,
                axisLine: {show: false}, axisTick: {show: false},
                axisLabel: {show: false}, splitLine: {show: false}
            }
        ],
        radiusAxis: [
            {
                polarIndex: 0,
                type: 'value', min: 0, max: niceMax,
                axisLine: {show: false}, axisTick: {show: false},
                splitLine: {show: true, lineStyle: {type: 'dashed', color: '#d0d0d0'}},
                axisLabel: {show: false}              // labels rendered on polar 1's axis below
            },
            {
                polarIndex: 1,
                type: 'value', min: 0, max: niceMax,
                axisLine: {show: false}, axisTick: {show: false}, splitLine: {show: false},
                axisLabel: {show: true, showMinLabel: false, fontSize: 7, color: '#888', formatter: '{value}%'}
            }
        ],
        tooltip: {
            trigger: 'item', appendToBody: true,
            position: function(point, params, dom, rect, size) {
                return [point[0] + 12, point[1] - size.contentSize[1] - 8];
            },
            formatter: function(p) {
                if (p.componentSubType !== 'bar') return '';
                return '<b>' + p.name + '</b> &middot; ' + p.seriesName +
                       '<br/>' + p.value.toFixed(1) + '%';
            }
        },
        series: opt.series.concat(series)
    });

    // Periodic re-render: update bar data + the radius-axis max on both
    // polars (so polar 1's labels keep matching polar 0's splitLines as the
    // data scale shifts). Bars are matched by id; the radiusAxis array is
    // merged by index, so polar 0's `max` and polar 1's `max` both update.
    // Store the interval handle on the gauge so loadGauges can clearInterval
    // it before disposing -- otherwise a stale tick fires setOption against a
    // disposed chart instance and throws.
    gauge.windRoseTimer = setInterval(() => {
        let { series, niceMax } = aggregate();
        gauge.setOption({
            radiusAxis: [{ max: niceMax }, { max: niceMax }],
            series: series
        });
    }, 5000);
}

// configobj-list-to-JS-array helpers: configobj gives scalar for 1 value,
// array for >=2, undefined when the key is absent.
function toArray(v, fallback) {
    if (v === undefined || v === null) return fallback;
    return Array.isArray(v) ? v : [v];
}
function toFloats(v, fallback) {
    return toArray(v, fallback).map(Number);
}

function parseBooleanDefaultTrue(value) {
    return parseBoolean(value, true);
}

function parseBooleanDefaultFalse(value) {
    return parseBoolean(value, false);
}

function parseBoolean(value, defaultValue) {
    if (value !== undefined && value !== null) {
        if (value.toLowerCase() === "false") {
            return false;
        } else if (value.toLowerCase() === "true") {
            return true;
        }
    }
    return defaultValue;
}

function getGaugeOption(name, min, max, splitNumber, axisTickSplitNumber, lineColor, unit, weewxData) {
    name = decodeHtml(name);
    let decimals = Number(weewxData.decimals);
    let value = null;
    let data = weewxData.dataset.data;
    if (data === undefined || data.length < 1) {
        value = null;
    } else {
        let index = 1;
        while (value === null && index <= data.length) {
            value = data.slice(index++ * -1)[0][1];
            if (!weewxData.stuckNeedleEnabled) {
                break;
            }
        }
    }
    let option = {
        animation: weewxData.animation === undefined || !weewxData.animation.toLowerCase() === "false",
        animationDurationUpdate: 750,
        series: [{
            name: name,
            type: 'gauge',
            min: Number(min),
            max: Number(max),
            splitNumber: Number(splitNumber),
            radius: '95%',
            axisLine: {
                lineStyle: {
                    width: weewxData.axisLineEnabled ? 8 : 0,
                    color: lineColor,
                    shadowBlur: weewxData.axisLineEnabled ? 3 : 0
                }
            },
            pointer: {
                show: !isNaN(parseFloat(value)),
                width: 5,
                itemStyle: {
                    color: '#428bca',
                    shadowBlur: 3
                }
            },
            axisTick: {
                splitNumber: axisTickSplitNumber,
                length: 4,
                // axisTick/splitLine/axisLabel distances are measured outward
                // from the axisLine. With the line hidden (axisLineEnabled
                // false) ECharts still uses its default offsets, leaving
                // ticks and the rim labels floating off the gauge body.
                // Pin them at distance 0 (right at the gauge radius) and 2
                // (just past them) so the inner-structure stays anchored.
                distance: weewxData.axisLineEnabled ? undefined : 0,
                lineStyle: {
                    color: 'auto'
                }
            },
            splitLine: {
                length: 6,
                distance: weewxData.axisLineEnabled ? undefined : 0,
                lineStyle: {
                    color: 'auto'
                }
            },
            axisLabel: {
                fontWeight: 'normal',
                fontSize: weewxData.labelFontSize === undefined ? 8 : weewxData.labelFontSize,
                distance: weewxData.axisLineEnabled ? undefined : 2,
                color: '#777',
                formatter: function (value, index) {
                    return round(value, 1);
                }
            },
            title: {
                fontWeight: 'normal',
                fontSize: weewxData.titleFontSize === undefined ? 10 : weewxData.titleFontSize,
                color: '#777',
                offsetCenter: ['0', '28%']
            },
            detail: {
                fontWeight: 'bold',
                fontSize: weewxData.detailFontSize === undefined ? 12 : weewxData.detailFontSize,
                color: '#777',
                formatter: function (value) {
                    if (isNaN(value)) {
                        return undefined;
                    } else {
                        if (decimals !== undefined && decimals >= 0) {
                            value = format(value, decimals);
                        }
                        return value + getUnitString(value, unit);
                    }
                },
                offsetCenter: ['0', '70%']
            },
            data: [{
                value: value,
                name: name
            }
            ]
        },
        ]
    };
    if (weewxData.heatMapEnabled) {
        option.series.push({
            name: "heat",
            z: -1,
            type: 'gauge',
            min: Number(min),
            max: Number(max),
            splitNumber: 0,
            radius: '95%',
            axisLine: {
                lineStyle: {
                    width: '100%',
                    color: getHeatColor(max, min, splitNumber, axisTickSplitNumber, data, gaugeHistoryMs(weewxData)),
                    shadowBlur: 3,
                }
            },
            pointer: {
                width: 5,
                itemStyle: {
                    color: '#428bca',
                    shadowBlur: 3
                }
            },
            axisTick: {
                show: false,
            },
            splitLine: {
                show: false,
            },
            axisLabel: {
                show: false,
            }
        });
    }
    return option;
}
$(window).on('resize', function () {
    for (let gaugeId of Object.keys(gauges)) {
        let gauge = gauges[gaugeId];
        if (gauge != null && gauge != undefined) {
            gauge.resize();
        }
    }
});

// Hours of history a gauge's heat ring / wind rose should reflect. A per-gauge
// `historyTimespan` (passed through the gauge style block) lets the gauges show
// a tighter window than the live charts -- e.g. a 1h frequency distribution on
// the heat rings while the charts keep the 3h dashboard.timespan. Falls back to
// the chart timespan when a gauge doesn't set it. Defined at top level so its
// `weewxData` is the GLOBAL (inside getGaugeOption the param of the same name
// shadows it); the gauge's own config is passed in as gaugeData.
function gaugeHistoryMs(gaugeData) {
    let hrs = Number(gaugeData && gaugeData.historyTimespan)
              || (weewxData.config && weewxData.config.timespan) || 1;
    return hrs * 3600000;
}

function getHeatColor(max, min, splitNumber, axisTickSplitNumber, data, maxAgeMs) {
    if (data === undefined || data === null) {
        return "#ffffff00";
    }
    if (maxAgeMs) {
        let cutoff = Date.now() - maxAgeMs;
        data = data.filter(p => Array.isArray(p) && p[0] >= cutoff);
    }
    let ticksNumber = splitNumber * axisTickSplitNumber;
    let range = max - min;
    let ticksRange = (range / ticksNumber);
    let splitValueCount = Array.apply(null, Array(ticksNumber)).map(function () {
        return 0;
    });
    let baseColor = '#ff0000';
    for (let item of data) {
        let value = item[1];
        if (value === null || value === undefined) {
            continue;
        }
        let index = 0;
        if (value > max) {
            index = splitValueCount.length - 1;
        } else if (value >= min) {
            index = Math.floor((value - min) / ticksRange);
        }
        splitValueCount[index]++;
    }
    let color = [];
    let ticksWidth = ticksRange / range;
    let until = ticksWidth;
    for (let count of splitValueCount) {
        let weight = Math.floor(maxOpacity * count / data.length);
        let opacity = Number(weight).toString(16);
        if (weight < 16) {
            opacity = "0" + opacity;
        }
        color.push([until, baseColor + opacity]);
        until += ticksWidth;
    }
    return color;
}

function getDecimalSeparator() {
    let n = 1.1;
    n = n.toLocaleString(jsLocale).substring(1, 2);
    return n;
}

var noReadingString = "--";
function format(number, digits) {
    if (number === noReadingString) {
        return number;
    }
    number = Number(number);
    let numString = parseFloat(number.toFixed(digits)).toLocaleString(jsLocale);
    let decimalSeparator = getDecimalSeparator();
    if (digits > 0 && !numString.includes(decimalSeparator)) {
        numString += decimalSeparator;
        for (let i = 0; i < digits; i++) {
            numString += "0";
        }
    }
    return numString;
}
