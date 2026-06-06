const BG_REGEX = /background-color:.*;/;
const DAY_NIGHT = "dayNight";
const DAY_NIGHT_KEY = DAY_NIGHT + "_";
const BAR = "bar";
const LINE = "line";
const SCATTER = "scatter";

let baseColor = '#111111';
let backGroundColor = baseColor + '0a';
let nightBackGroundColorModifier = '1a';

function loadCharts() {
    for (let chartId of Object.keys(weewxData.charts)) {
        let documentChartId = chartId + CHART;

        if (charts[documentChartId] !== undefined) {
            charts[documentChartId].dispose();
            charts[documentChartId] = undefined;
        }

        let chartElement = document.getElementById(documentChartId);
        if (chartElement === null || chartElement === undefined) {
            continue;
        }
        let chart = echarts.init(chartElement, null, { locale: eChartsLocale });
        chart.weewxData = weewxData.charts[chartId];
        charts[documentChartId] = chart;
        let chartSeriesConfigs = [];

        let timestamp = 0;

        for (let categoryId of Object.keys(weewxData.charts[chartId])) {
            let category = weewxData.charts[chartId][categoryId];
            if (typeof category !== 'object' || category === null) {
                continue;
            }
            chart.weewxData[categoryId].observationType = categoryId;
            addUndefinedIfCurrentMissing(weewxData[categoryId]);

            let plotType = category.plotType == undefined ? LINE : category.plotType;
            let aggregateType = category.aggregateType === undefined ? SUM : category.aggregateType;
            let aggregateInterval = category.aggregateInterval;

            let dataReferences = undefined ? undefined : category.dataReferences;
            if (dataReferences !== undefined && !Array.isArray(dataReferences)) {
                dataReferences = [dataReferences];
            }
            let seriesName = category.seriesName === undefined ? weewxData.labels.Generic[categoryId] : category.seriesName;
            let chartSeriesConfig = {
                name: decodeHtml(seriesName),
                plotType: plotType,
                dataReferences: dataReferences === undefined ? [] : dataReferences,
                yAxisIndex: category.yAxisIndex === undefined ? 0 : category.yAxisIndex,
                aggregateType: aggregateType,
                aggregateInterval: aggregateInterval,
                payloadKey: category.payload_key,
                labelFontSize: category.labelFontSize === undefined ? 11 : category.labelFontSize,
                showTooltipValueNone: getBooleanOrDefault(category.showTooltipValueNone, plotType === BAR ? true : false),
                obs_group: category.obs_group,
                weewxColumn: categoryId,
                decimals: Number(category.decimals),
                interval: numberOrUndefined(category.interval),
                minInterval: numberOrUndefined(category.minInterval),
                maxInterval: numberOrUndefined(category.maxInterval),
                splitNumber: numberOrUndefined(category.splitNumber),
                showMaxMarkPoint: getBooleanOrDefault(category.showMaxMarkPoint, false),
                showMinMarkPoint: getBooleanOrDefault(category.showMinMarkPoint, false),
                showAvgMarkLine: getBooleanOrDefault(category.showAvgMarkLine, false),
                lineColor: category.lineColor,
                data: weewxData[categoryId],
                unit: weewxData.units.Labels[category.target_unit],
                symbol: category.symbol,
                symbolSize: category.symbolSize,
                showRollingIqrBandMinutes: category.showRollingIqrBandMinutes,
                chartId: chartId,
            }
            if (category.lineWidth !== undefined) {
                chartSeriesConfig.lineStyle = {
                    width: category.lineWidth,
                };
            }
            chartSeriesConfigs.push(chartSeriesConfig);

            if (weewxData[categoryId] !== undefined && weewxData[categoryId] !== null && weewxData[categoryId].length > 1) {
                let categoryTimestamp = weewxData[categoryId].slice(-1)[0][0];
                if (categoryTimestamp !== undefined && categoryTimestamp > timestamp) {
                    timestamp = categoryTimestamp;
                }
            }
        }

        let chartOption = getChartOption(chartSeriesConfigs);

        // Anchor every chart's xAxis to the current timespan window ending
        // NOW rather than letting ECharts auto-fit to series data range.
        // Without this, a stalled archive leaves the chart's right edge
        // frozen at the last data timestamp -- the dashboard renders
        // yesterday's data with yesterday's day/night shading even when the
        // user is viewing the next afternoon. Forcing the range to
        // [now - timespan, now] makes every chart a live "current N hours"
        // view: data points render where they land (empty trailing region
        // when archive is stale, which honestly signals "no recent data"),
        // every chart shares an identical window (so the rain chart's axis
        // matches the line charts to the pixel), and day/night shading
        // reflects current time given enough forward sun events in the
        // weewxData.json (jsonengine.py generates a 36 h forward buffer).
        let timespanMs = weewxData.config.timespan * 3600000;
        let end = Date.now();
        let start = end - timespanMs;
        chartOption.xAxis.min = start;
        chartOption.xAxis.max = end;

        chartSeriesConfigs.push(getDayNightSeries(chartOption, chartId, start, end));

        // Bar series + type:"time" xAxis + no visible bars (all data
        // empty, null, or zero) is an ECharts quirk: the coordinate
        // system gets set up correctly but xAxis tick labels are
        // silently suppressed. Verified empirically -- rain (empty bar
        // after all-null aggregation) and radiation (UV all-zero bar at
        // night) rendered with no xAxis ticks; lightning_strikes (empty
        // SCATTER on the same dashboard with identical xAxis config)
        // rendered ticks normally. Switch invisible bars to invisible
        // lines so ECharts treats the chart as line-only for axis
        // rendering purposes; the series stays in chartOption.series so
        // any later updateChart() / addValue() flow still finds it by
        // name. The next loadCharts() pass sees hasVisibleBar=true once
        // non-zero data arrives and leaves the series as type:"bar".
        chartOption.series.forEach(s => {
            if (s.type !== "bar") return;
            let hasVisibleBar = s.data && s.data.some(p =>
                Array.isArray(p) && p[1] !== null && p[1] !== undefined && Number(p[1]) > 0
            );
            if (!hasVisibleBar) {
                s.type = "line";
                s.lineStyle = { opacity: 0 };
                s.symbol = "none";
            }
        });

        chartOption.animation = chart.weewxData.animation === undefined || !chart.weewxData.animation.toLowerCase() === "false";
        chartOption.textStyle = {
            fontSize: chart.weewxData.fontSize === undefined ? 10 : chart.weewxData.fontSize,
        };
        // EXPERIMENTAL (sailing-center): inject the wind rolling-stat overlays
        // into this chart's option BEFORE it renders, so they're part of the
        // normal build -- one setOption, palette stays aligned (overlays carry
        // explicit colours), no getOption round-trip. No-op except the wind chart.
        // Defined in the WIND-STAT block appended at the end of this file.
        if (typeof windStatInject === "function") windStatInject(chart, chartOption, chartId);
        chart.setOption(chartOption);
        chartElement.appendChild(getTimestampDiv(documentChartId, timestamp));
    }

}

function getBooleanOrDefault(value, defaultValue) {
    return value === undefined ? defaultValue : value.toLowerCase() === 'true';
}

// Numeric axis params (interval/minInterval/maxInterval/splitNumber) arrive from
// the skin/weewxData config as strings. ECharts needs real numbers: a string
// minInterval like "5" yields uneven split lines (e.g. ticks 60,65,80 instead of
// 60,65,70,75,80). Coerce, but keep undefined/empty as undefined so ECharts auto-
// scales (decimals is already Number()-ed the same way).
function numberOrUndefined(value) {
    return value === undefined || value === null || value === "" ? undefined : Number(value);
}

function getDayNightSeries(chartOption, chartId, start, end) {
    let data = [];

    if (weewxData['day_night_events'] === undefined) {
        return data;
    }

    weewxData['day_night_events'].forEach(
        (element, index) => {
            data.push([element[0], undefined]);
        }
    );
    if (start !== undefined && data[0] !== undefined) {
        data[0][0] = start;
    }
    if (end !== undefined && data[data.length - 1] !== undefined) {
        data[data.length - 1][0] = end;
    }

    // Anchor the dayNight series so EMPTY charts still initialise a coordinate
    // system. ECharts treats a series with all-undefined y values as having no
    // usable data: for charts where this synthetic series is the ONLY one with
    // anchored points (rain with all-null archive rows, lightning_strikes
    // scatter with no strike events), no coordinate system is initialised,
    // no xAxis ticks render, and the markArea has nothing to paint against.
    //
    // But a y=0 anchor is harmful on a chart that DOES have real data: scale:true
    // fits the min/max of EVERY series on the axis, so the 0 anchor drags the
    // floor to zero -- non-zero-based charts render 0-30 (barometer ~29.8) or
    // 0-80 (outTemp ~70) instead of fitting their band. So only anchor at 0 when
    // there's no real data to set the range; otherwise leave the y values
    // undefined and let the real series scale the axis. (getDayNightMarkArea
    // bands are xAxis-only -- they span the full height regardless -- so the
    // shading renders identically either way; only the y-extent differs.)
    //
    // "Real data" = any non-null/undefined y in any already-built series (0 counts
    // -- an all-zero night radiation chart has a usable coord system and needs no
    // anchor). All-null / empty series fall through to the 0 anchor.
    //
    // The line itself stays invisible: lineStyle.opacity=0 + symbol='none'.
    let hasRealData = chartOption.series.some(s =>
        Array.isArray(s.data) && s.data.some(p =>
            Array.isArray(p) ? (p[1] !== null && p[1] !== undefined)
                             : (p !== null && p !== undefined)
        )
    );
    let anchorY = hasRealData ? undefined : 0;
    let dayNightSerie = {
        "name": DAY_NIGHT,
        "type": "line",
        "data": [[start, anchorY], [end, anchorY]],
        "lineStyle": { "opacity": 0 },
        "symbol": "none",
        "markArea": getDayNightMarkArea(),
    }

    chartOption.series.push(dayNightSerie);

    return {
        name: DAY_NIGHT_KEY + chartId,
        data: data,
    }
}


function getChartOption(seriesConfigs) {
    let series = [];
    let colors = [];
    let yAxisIndices = [];
    let legendData = [];
    let z = seriesConfigs.length;
    for (let seriesConfig of seriesConfigs) {
        if (seriesConfig.plotType === SCATTER && seriesConfig.dataReferences.length < 1) {
            continue;
        }
        getSeriesConfig(seriesConfig, series, colors, z--);
        yAxisIndices[seriesConfig.yAxisIndex] = Array();
        yAxisIndices[seriesConfig.yAxisIndex]["unit"] = seriesConfig.unit;
        yAxisIndices[seriesConfig.yAxisIndex]["obs_group"] = seriesConfig.obs_group;
        yAxisIndices[seriesConfig.yAxisIndex]["decimals"] = seriesConfig.decimals;
        yAxisIndices[seriesConfig.yAxisIndex]["interval"] = seriesConfig.interval;
        yAxisIndices[seriesConfig.yAxisIndex]["minInterval"] = seriesConfig.minInterval;
        yAxisIndices[seriesConfig.yAxisIndex]["maxInterval"] = seriesConfig.maxInterval;
        yAxisIndices[seriesConfig.yAxisIndex]["splitNumber"] = seriesConfig.splitNumber;
        yAxisIndices[seriesConfig.yAxisIndex]["labelFontSize"] = seriesConfig.labelFontSize;
    }

    for (let serie of series) {
        if (!serie.name || serie.name.startsWith(DAY_NIGHT_KEY)) {
            continue;   // skip day/night + the unnamed IQR-band helper series
        }
        let legendItem = {
            name: serie.name
        }
        if (serie.symbol !== undefined && serie.symbol !== 'none') {
            legendItem.icon = serie.symbol;
        }
        legendData.push(legendItem);
    }

    let yAxis = [];
    for (let yAxisIndex of Object.keys(yAxisIndices)) {
        let obs_group = yAxisIndices[yAxisIndex]["obs_group"];
        let unit = yAxisIndices[yAxisIndex]["unit"];
        let decimals = yAxisIndices[yAxisIndex]["decimals"];
        let interval = yAxisIndices[yAxisIndex]["interval"];
        let minInterval = yAxisIndices[yAxisIndex]["minInterval"];
        let maxInterval = yAxisIndices[yAxisIndex]["maxInterval"];
        let splitNumber = yAxisIndices[yAxisIndex]["splitNumber"];
        let yAxisItem = {
            name: Array.isArray(unit) && unit.length > 1 ? unit[1] : unit,
            type: "value",
            alignTicks: true,
            interval: interval,
            minInterval: minInterval,
            maxInterval: maxInterval,
            splitNumber: splitNumber,
            nameTextStyle: {
                fontWeight: 'bold',
            },
            axisLabel: {
                formatter: function (value, index) {
                    let formattedValue = format(value, decimals);
                    if (value * Math.pow(10, decimals) % 1 != 0) {
                        formattedValue = "";
                    }
                    if (value >= 1000) {
                        formattedValue = value.toFixed();
                        if (value % 1 != 0) {
                            formattedValue = "";
                        }
                    }
                    return formattedValue;
                },
                fontSize: yAxisIndices[yAxisIndex]["labelFontSize"]
            },
            scale: true,
        };
        if (obs_group === "group_speed" || obs_group === "group_distance" || obs_group === "group_uv") {
            // group_uv: UV index is always >= 0, and on the radiation chart UV
            // renders as bars (whose height must read from a 0 baseline), so
            // floor the axis at 0 rather than letting scale:true auto-fit it to
            // a non-zero min. Max stays auto (UV can spike into the teens).
            yAxisItem.min = 0;
        }
        if (obs_group === "group_percent") {
            yAxisItem.min = 0;
            yAxisItem.max = 100;
        }
        if (obs_group === "group_direction") {
            yAxisItem.min = 0;
            yAxisItem.max = 360;
            yAxisItem.minInterval = 90;
            yAxisItem.maxInterval = 90;
        }
        yAxis.push(yAxisItem);
    }

    return {
        legend: {
            type: "plain",
            data: legendData
        },
        color: colors,
        // Transparent chart background lets the host page's background show
        // through, so the chart blends in instead of carrying a baseline dark
        // tint (`#111111` at ~4% alpha). The day/night markArea bands remain
        // the only chromatic signal: day = page background as-is, night =
        // page background + a darker overlay (see getColorModifier).
        backgroundColor: 'transparent',
        toolbox: {
            show: false,
            top: 10,
            feature: {
                dataZoom: {
                    yAxisIndex: "none"
                }
            }
        },
        tooltip: getTooltip(seriesConfigs),
        xAxis: {
            show: true,
            minInterval: getXMinInterval(),
            axisLine: {
                show: false
            },
            axisTick: {
                show: false
            },
            type: "time",
            splitLine: {
                show: true
            },
            axisLabel: {
                formatter: function (value, idx) {
                    let day = luxon.DateTime.fromMillis(value, { zone: stationTimezone }).startOf('day').toMillis();
                    if (value === day) {
                        return `{day|${formatDate(value, stationTimezone, { day: 'numeric' })}}`;
                    } else {
                        return formatTime(value, stationTimezone, luxon.DateTime.TIME_24_SIMPLE);
                    }
                },
                rich: {
                    day: {
                        fontSize: '10px',
                        fontWeight: 'bold'
                    }
                }
            },
        },
        yAxis: yAxis,
        series: series
    }
}

function getTooltip(seriesConfigs) {
    let containsScatter = false;
    for (let seriesConfig of seriesConfigs) {
        if (seriesConfig.plotType === SCATTER) {
            containsScatter = true;
        }
    }
    return {
        trigger: containsScatter ? "item" : "axis",
        axisPointer: {
            type: LINE
        },
        show: true,
        position: containsScatter ? "top" : "inside",
        formatter: function (params, ticket, callback) {
            let seriesName = Array.isArray(params) ? params[0].seriesName : params.seriesName;
            if (seriesName.includes(DAY_NIGHT)) {
                return;
            }
            let tooltipHTML = '<table>';
            let show = true;
            let marker;
            let itemIndex;
            let axisValue;

            if (Array.isArray(params)) {
                marker = params[0].marker;
                itemIndex = params[0].seriesIndex;
                axisValue = params[0].axisValue;
            } else {
                marker = params.marker;
                itemIndex = params.seriesIndex;
                axisValue = params.data[0];
            }

            let intervals = [];
            for (let i = 0; i < seriesConfigs.length; i++) {
                let seriesItem = seriesConfigs[i];
                if (seriesItem.name.startsWith(DAY_NIGHT_KEY)) {
                    continue;
                }
                let unitString = seriesItem.unit === undefined ? "" : seriesConfigs[i].unit;
                let aggregateInterval = seriesItem.aggregateInterval;
                intervals.push(aggregateInterval);

                let formattedValue = "-";
                let dataValue;
                if (Array.isArray(params)) {
                    // Match the param by series NAME, not by loop index: extra
                    // series interleaved into the ECharts series array (the IQR
                    // band helpers; day/night) make params[i] no longer line up
                    // with seriesConfigs[i], which would read another series'
                    // value (e.g. windGust showing the windSpeed band's Q1).
                    // Fall back to a direct lookup by axis value when the series
                    // has no param at this x (a gap).
                    let p = params.find(function (x) { return x.seriesName === seriesItem.name; });
                    dataValue = (p !== undefined && p["data"] !== undefined)
                        ? p["data"][1]
                        : getDataValue(axisValue, seriesItem.data);
                } else {
                    dataValue = getDataValue(axisValue, seriesItem.data);
                }
                if (!Array.isArray(params) && params["data"][i + 1] !== undefined) {
                    dataValue = params["data"][i + 1];
                }
                if (dataValue === undefined && !seriesItem.showTooltipValueNone) {
                    continue;
                }
                let aggregateAxisValue = axisValue;
                if (aggregateInterval !== undefined) {
                    let halfAggregateInterval = aggregateInterval * 1000 / 2;

                    if (dataValue === undefined) {
                        aggregateAxisValue = getAggregateAxisValue(aggregateAxisValue, seriesItem.data, halfAggregateInterval);
                        dataValue = getDataValue(aggregateAxisValue, seriesItem.data);
                    }
                    let fromDate = new Date(aggregateAxisValue - halfAggregateInterval);
                    let toDate = new Date(aggregateAxisValue + halfAggregateInterval);
                    let from = formatDateTime(fromDate, stationTimezone);
                    let to = formatTime(toDate, stationTimezone);
                    if (i == 0 || aggregateInterval !== intervals[i - 1]) {
                        tooltipHTML += '<tr><td colspan="2" style="font-size: x-small;">' + from + " - " + to + '</td></tr>';
                    }
                } else {
                    let date = new Date(aggregateAxisValue);
                    if (i == 0 || aggregateInterval !== intervals[i - 1]) {
                        tooltipHTML += '<tr><td colspan="2" style="font-size: x-small;">' + formatDateTime(date, stationTimezone) + '</td></tr>';
                    }
                }

                if (dataValue !== undefined && dataValue !== null) {
                    let formattedDataValue = format(dataValue, seriesItem.decimals);
                    formattedValue = formattedDataValue + getUnitString(formattedDataValue, unitString);
                }
                tooltipHTML += ('<tr style="font-size: small;"><td>' + marker.replace(BG_REGEX, "background-color:" + seriesItem.lineColor + ";") + seriesItem.name + '</td><td style="text-align: right; padding-left: 10px; font-weight: bold;">' + formattedValue + '</td></tr>');

                // Surface the rolling IQR band's spread as a sub-row, using the
                // exact rendered Q1/Q3 at the hovered x (seriesConfig.iqrByX,
                // keyed by the band's midpoint-shifted x positions). Absent at
                // the live edge (the band's ~half-window gap), so it simply
                // doesn't show there -- matching the chart.
                if (seriesItem.showRollingIqrBandMinutes && seriesItem.iqrByX) {
                    let b = seriesItem.iqrByX[axisValue];
                    if (b !== undefined) {
                        let lo = format(b[0], seriesItem.decimals);
                        let hi = format(b[1], seriesItem.decimals);
                        tooltipHTML += ('<tr style="font-size: x-small; opacity: 0.7;"><td style="padding-left: 18px;">' + seriesItem.showRollingIqrBandMinutes + 'm IQR</td><td style="text-align: right; padding-left: 10px;">' + lo + "–" + hi + getUnitString(hi, unitString) + '</td></tr>');
                    }
                }

            }
            return show ? tooltipHTML + '</table>' : "";
        }
    }
}

function getDataValue(axisValue, data) {
    for (let item of data) {
        if (item[0] === axisValue) {
            return item[1];
        }
    }
    return undefined;
}

function getAggregateAxisValue(axisValue, data, halfAggregateInterval) {
    if (data.length < 1) {
        return;
    }
    let aggregateAxisValue = data[0][0];
    let diff = Math.abs(axisValue - aggregateAxisValue);
    for (let item of data) {
        if (diff < halfAggregateInterval) {
            return aggregateAxisValue;
        } else {
            aggregateAxisValue = item[0];
            if (diff != halfAggregateInterval || aggregateAxisValue == data[0][0]) {
                diff = Math.abs(axisValue - aggregateAxisValue);
            } else {
                diff = 0;
            }
        }
    }
    return aggregateAxisValue;
}

// Linear-interpolation quantile of an already-ascending-sorted array.
function quantileSorted(sorted, q) {
    let n = sorted.length;
    if (n === 0) return null;
    if (n === 1) return sorted[0];
    let pos = (n - 1) * q;
    let base = Math.floor(pos);
    let rest = pos - base;
    return sorted[base + 1] !== undefined
        ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
        : sorted[base];
}

// Rolling interquartile (Q1..Q3) band for a series, as two ECharts line series
// using the stacked-area trick (ECharts has no native band): an invisible
// lower=Q1 line + a transparent-line area carrying (Q3-Q1) stacked on top,
// which fills Q1..Q3 translucently. For each sample at t we take the trailing
// [t-windowMs, t] values; the result is plotted at the window MIDPOINT
// (t - windowMs/2) so the band centres on the data it summarises instead of
// lagging it by half a window -- leaving an honest ~half-window gap at the
// live edge (the centred spread there isn't knowable yet). Derived in JS from
// the series' own data, so no extra obs/column. NB recomputed at load + each
// async reload, not per live packet (v1).
function rollingIqrBandSeries(data, windowMs, color, yAxisIndex, stackName) {
    let half = windowMs / 2;
    let lower = [];
    let upperDelta = [];
    for (let i = 0; i < data.length; i++) {
        let t = data[i][0];
        let v = data[i][1];
        let at = t - half;
        if (v === null || v === undefined || isNaN(v)) {
            lower.push([at, null]);
            upperDelta.push([at, null]);
            continue;
        }
        let win = [];
        for (let j = 0; j <= i; j++) {
            let p = data[j];
            if (p[0] >= t - windowMs && p[0] <= t && p[1] !== null && p[1] !== undefined && !isNaN(p[1])) {
                win.push(Number(p[1]));
            }
        }
        win.sort(function (a, b) { return a - b; });
        let q1 = quantileSorted(win, 0.25);
        let q3 = quantileSorted(win, 0.75);
        lower.push([at, q1]);
        upperDelta.push([at, q3 - q1]);
    }
    let base = {
        type: "line", stack: stackName, name: "", symbol: "none",
        silent: true, z: 0, yAxisIndex: yAxisIndex, lineStyle: { opacity: 0 }
    };
    return [
        Object.assign({}, base, { data: lower, areaStyle: { opacity: 0 } }),
        Object.assign({}, base, { data: upperDelta, areaStyle: { color: color, opacity: 0.18 } }),
    ];
}

function getSeriesConfig(seriesConfig, series, colors, z) {
    colors.push(seriesConfig.lineColor);
    if (seriesConfig.data === undefined) {
        seriesConfig.data = [];
    }
    let type = seriesConfig.plotType;
    if (seriesConfig.aggregateInterval !== undefined) {
        seriesConfig.data = aggregate(seriesConfig.data, seriesConfig.aggregateInterval, seriesConfig.aggregateType, seriesConfig.decimals);
    }
    let serie = {
        name: decodeHtml(seriesConfig.name),
        z: z,
        payloadKey: seriesConfig.payloadKey,
        weewxColumn: seriesConfig.weewxColumn,
        unit: seriesConfig.unit,
        decimals: seriesConfig.decimals,
        type: type,
        barWidth: '100%', //only applies to barchart
        barGap: '-100%', //only applies to barchart
        symbol: seriesConfig.symbol === undefined ? 'none' : seriesConfig.symbol,
        symbolKeepAspect: true,
        lineStyle: {
            width: seriesConfig.lineStyle === undefined || seriesConfig.lineStyle.width === undefined ? 1 : seriesConfig.lineStyle.width,
        },
        data: seriesConfig.data,
        yAxisIndex: seriesConfig.yAxisIndex,
    };


    if (seriesConfig.symbolSize !== undefined) {
        serie.symbolSize = new Function("return " + seriesConfig.symbolSize)();
    }

    if (seriesConfig.plotType === SCATTER) {
        let groups = [weewxData.units.Groups[seriesConfig.obs_group]];
        let decimals = [seriesConfig.decimals];
        for (let dataReference of seriesConfig.dataReferences) {
            serie.name = weewxData.labels.Generic[dataReference] + " / " + serie.name;
            groups.push(weewxData.units.Groups[weewxData.charts[seriesConfig.chartId][dataReference].obs_group]);
            decimals.push(weewxData.charts[seriesConfig.chartId][dataReference].decimals);
            for (let i = 0; i < seriesConfig.data.length; i++) {
                let entry = seriesConfig.data[i];
                for (let referencedData of weewxData[dataReference]) {
                    if (referencedData[0] === entry[0]) {
                        entry.push(referencedData[1]);
                        if (referencedData[1] === 0 || referencedData[1] === null) {
                            entry[1] = null;
                        }
                    }
                }
            }
        }
        serie.emphasis = {
            focus: 'none',
            label: {
                show: true,
                formatter: function (param) {
                    //let date = new Date(param.data[0]);
                    let value = "";
                    for (let i = 0; i < seriesConfig.dataReferences.length; i++) {
                        value += format(param.data[i + 2], decimals[i + 1]) + weewxData.units.Labels[groups[i + 1]]
                    }

                    return value + " / " + format(param.data[1], decimals[0]) + weewxData.units.Labels[groups[0]];
                },
                position: 'top'
            }
        }
    }

    seriesConfig.serie = serie;


    if (seriesConfig.showMaxMarkPoint || seriesConfig.showMinMarkPoint) {
        let markPoint = {};
        markPoint.symbolSize = 0;
        markPoint.data = [];
        for (let dataPoint of weewxData[seriesConfig.weewxColumn + "_" + DAILY_HIGH_LOW_KEY]) {
            let name = DAILY_MAX;
            let position = "top";
            let value = dataPoint[1];
            let valueTimestamp = dataPoint[0];
            if (dataPoint[2] === "min") {
                name = DAILY_MIN;
                position = "bottom";
            }
            markPoint.data.push({
                coord: [valueTimestamp, value],
                name: name,
                label: {
                    show: true,
                    position: position,
                    formatter: format(value, seriesConfig.decimals).toString(),
                }
            });
        }
        serie.markPoint = markPoint;
    }
    if (seriesConfig.showAvgMarkLine) {
        serie.markLine = {
            precision: seriesConfig.decimals,
            data: [{
                type: "average",
                name: "Avg",
                label: {
                    formatter: function (value, ticket) {
                        value = format(value.data.value, seriesConfig.decimals);
                        return value + getUnitString(value, seriesConfig.unit);
                    }
                }
            }
            ]
        };
    }

    series.push(serie);

    // Optional rolling interquartile band behind this series. The two helper
    // series are pushed straight onto the ECharts `series` array (not into
    // seriesConfigs), so they stay out of the tooltip table (built from
    // seriesConfigs) and the legend (empty name, skipped below). Push matching
    // placeholder colours so the chart-level palette stays index-aligned with
    // the real series that follow.
    if (seriesConfig.showRollingIqrBandMinutes) {
        let bands = rollingIqrBandSeries(
            seriesConfig.data,
            Number(seriesConfig.showRollingIqrBandMinutes) * 60000,
            seriesConfig.lineColor,
            seriesConfig.yAxisIndex,
            seriesConfig.weewxColumn + "_iqrBand");
        bands.forEach(function (b) { series.push(b); colors.push(seriesConfig.lineColor); });
        // Stash Q1/Q3 by x-position so the tooltip can surface the band's
        // spread at the hovered time using the EXACT rendered values (no
        // recompute). bands[0]=lower(Q1), bands[1]=delta(Q3-Q1), sharing the
        // (midpoint-shifted) x positions. seriesConfig is the same object the
        // tooltip formatter iterates, so this is visible there.
        let q1d = bands[0].data, dld = bands[1].data, byX = {};
        for (let k = 0; k < q1d.length; k++) {
            if (q1d[k][1] !== null && dld[k][1] !== null) {
                byX[q1d[k][0]] = [q1d[k][1], q1d[k][1] + dld[k][1]];
            }
        }
        seriesConfig.iqrByX = byX;
    }
}

function getXMinInterval() {
    return weewxData.config.timespan * 3600000 / 8;
}

function addUndefinedIfCurrentMissing(data) {
    if (data === undefined || data === null) {
        return;
    }
    let latestTimestamp = 0;
    if (data.length > 0) {
        latestTimestamp = data[data.length - 1][0];
    }
    if (Date.now() - latestTimestamp > weewxData.config.archive_interval * 1000) {
        data.push([Date.now(), undefined]);
    }
}

function getTimestampDiv(parentId, timestamp) {
    let outerDiv = document.createElement("div");
    outerDiv.setAttribute("class", "chartTimestampOuter");
    let timestampDiv = document.createElement("div");
    timestampDiv.id = parentId + "_timestamp";
    timestampDiv.setAttribute("class", "chartTimestamp");
    if (timestamp > 0) {
        timestampDiv.innerHTML = formatDateTime(timestamp, stationTimezone);
    }
    outerDiv.appendChild(timestampDiv);
    return outerDiv;
}

// Plausible upper bound on how long after the last sun event the same
// brightness state is still valid. 14 h covers the longest "night" / "day"
// stretch outside the polar circles, and prevents the trailing band from
// painting a stale "night" colour across the chart's right edge when the
// data outlives the jsonengine-emitted events (e.g. archive keeps writing
// past sunset but no new sun event has been generated yet).
const MAX_TRAILING_BAND_MS = 14 * 60 * 60 * 1000;

function getDayNightMarkArea() {
    let dayNightEvents = weewxData['day_night_events'];
    let data = [];
    if (dayNightEvents === undefined) {
        return data;
    }
    dayNightEvents.forEach(
        (element, index) => {
            let last = dayNightEvents[index + 1];
            let start = index == 0 ? undefined : element[0];
            // For the trailing band, cap the extent at MAX_TRAILING_BAND_MS
            // past the last known event instead of letting it run to the
            // chart's right edge. Without the cap, a sunset event at 19:00
            // followed by chart data extending to "now" (e.g. live MQTT
            // continued past sunset, or our empty-data axis fallback
            // anchored the chart to current time) paints "night" across the
            // whole trailing region -- including current-afternoon territory
            // where it's clearly daytime. The cap leaves anything past the
            // bound unshaded, which is the right "we don't know" UX.
            let end;
            if (index == dayNightEvents.length - 1) {
                end = element[0] + MAX_TRAILING_BAND_MS;
            } else {
                end = last[0];
            }
            let extentEnd = last !== undefined ? last[1] : element[1];
            let part = getPart(start, end, element[1], extentEnd);
            data.push(part);

        }
    );

    return {
        data: data,
        silent: true
    }
}



function getPart(start, end, startDarkeningExtent, endDarkeningExtent) {
    return [
        {
            itemStyle: {
                color: {
                    type: 'linear',
                    x: 0,
                    y: 0,
                    x2: 1,
                    y2: 0,
                    colorStops: [{
                        offset: 0, color: baseColor + getColorModifier(startDarkeningExtent)
                    }, {
                        offset: 1, color: baseColor + getColorModifier(endDarkeningExtent)
                    }],
                    global: false
                }
            },
            xAxis: start
        },
        {
            xAxis: end
        }
    ];
}

function getColorModifier(extent) {
    return Math.round(
        Number('0x' + nightBackGroundColorModifier) * extent
    ).toString(16).padStart(2, '0');
}

// ===========================================================================
// MCSC wind chart (sailing-center) -- finalized per the implementation spec.
// Integrated into this fork-of-the-fork charts.js (delivered via station.yaml
// branding.fragments: [js/charts.js], which overwrites the skin's copy).
//
// At-a-glance, sailing-aware view of the live wind chart:
//   - sailing flag bands (Light/Medium/Heavy/No-sailing) as the background
//   - speed: rolling-median spine + IQR band (sustained / gust-suppressed)
//   - gust:  rolling-median spine + a "ceiling" zone (speed p75 floor -> gust p90)
//   - raw 60 s dots kept on top (honesty layer)
//   - a discrete "now" readout (zero-phase bands stop ~2.5 min short of live edge)
//
// Fixed design, no control bar. windStatInject() runs from loadCharts() with the
// chart option BEFORE setOption (one build pass; overlays carry explicit colours
// so the base palette is untouched). Window = 5 min CENTERED + TIME-based, so
// batched/dropped records stay correct. Percentiles are type-7 (linear interp).
// Y is anchored at 0 but the TOP autoscales (the fixed 0-30 was only for
// comparing variants). Gust = per-minute max => an upper extreme by construction,
// so its band is a one-sided ceiling, never a symmetric tail.
// ===========================================================================
(function () {
  var CHART_KEY = "windSpeedChart";   // ECharts instance key + DOM id
  var CHART_ID  = "windSpeed";        // weewxData.charts id (loadCharts loop key)
  var SPEED_OBS = "windSpeed", GUST_OBS = "windGust";
  var MARK = "__wsc";
  var HALF_MS = 2.5 * 60000;          // half of the 5-min centered window
  var SPEED = "#428bca", GUST = "#b44242", GRID = "#e7e7f0", AXIS = "#9aa0ad";

  // sailing flag bands (club colours). hi=Infinity -> open-topped band (see flagCarrier)
  var FLAGS = [
    { name: "Light",      lo: 0,  hi: 10,       flag: "#ffffff", fill: null,      alpha: 0,    ink: "#6b7884", border: "#c9ced6" },
    { name: "Medium",     lo: 10, hi: 15,       flag: "#ffc000", fill: "#ffc000", alpha: 0.08, ink: "#9a7400", border: null },
    { name: "Heavy",      lo: 15, hi: 20,       flag: "#00b050", fill: "#00b050", alpha: 0.08, ink: "#1f7a55", border: null },
    { name: "No sailing", lo: 20, hi: Infinity, flag: "#000000", fill: "#22262e", alpha: 0.11, ink: "#2a2e36", border: null }
  ];

  function num(a, b) { return a - b; }
  function wsQuantile(sorted, q) {            // type-7 / inclusive linear interpolation
    var n = sorted.length; if (n === 0) return null; if (n === 1) return sorted[0];
    var pos = (n - 1) * q, base = Math.floor(pos), rest = pos - base;
    return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
  }
  function valsInWindow(arr, t) {             // values within +/- HALF_MS of t
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i];
      if (p[0] >= t - HALF_MS && p[0] <= t + HALF_MS && p[1] !== null && p[1] !== undefined && !isNaN(p[1]))
        out.push(Number(p[1]));
    }
    return out;
  }
  function rgba(hex, a) {
    var h = hex.replace("#", "");
    return "rgba(" + parseInt(h.substr(0, 2), 16) + "," + parseInt(h.substr(2, 2), 16) + "," + parseInt(h.substr(4, 2), 16) + "," + a + ")";
  }

  function band(stack, lower, delta, color, alpha, z) {
    var base = { type: "line", stack: stack, name: "", symbol: "none", silent: true, z: z,
                 yAxisIndex: 0, smooth: true, lineStyle: { opacity: 0 } };
    base[MARK] = true;
    return [ Object.assign({}, base, { data: lower, areaStyle: { opacity: 0 } }),
             Object.assign({}, base, { data: delta, areaStyle: { color: color, opacity: alpha } }) ];
  }
  function spine(name, data, color, width, z) {
    var s = { type: "line", name: name, data: data, symbol: "none", z: z, yAxisIndex: 0,
              smooth: true, silent: true, lineStyle: { color: color, width: width }, itemStyle: { color: color } };
    s[MARK] = true; return s;
  }
  function flagLabel(f) {
    // open-topped band (No sailing) centers off-screen -> anchor at its bottom;
    // finite bands center vertically.
    return { show: true, position: f.hi === Infinity ? "insideBottomLeft" : "insideLeft", distance: 7,
      rich: { sw: { width: 9, height: 9, backgroundColor: f.flag, borderColor: f.border || f.flag, borderWidth: f.border ? 1 : 0 },
              tx: { color: f.ink, fontSize: 10, padding: [0, 0, 0, 5] } },
      formatter: "{sw|}{tx|" + f.name + "}",
      backgroundColor: "rgba(255,255,255,0.78)", borderColor: "rgba(0,0,0,0.06)", borderWidth: 1,
      padding: [2, 6, 2, 4], borderRadius: 9 };
  }
  function flagCarrier(firstT, lastT) {
    // No-sailing top: a large constant (not 'max', which markArea resolves against
    // the carrier's null data) so the band fills to the autoscaling axis top.
    var s = { type: "line", name: "", data: [[firstT, null], [lastT, null]], symbol: "none",
              silent: true, z: -2, yAxisIndex: 0, lineStyle: { opacity: 0 },
              markArea: { silent: true, data: FLAGS.map(function (f) {
                return [ { yAxis: f.lo, itemStyle: { color: f.alpha ? rgba(f.fill, f.alpha) : "rgba(0,0,0,0)" }, label: flagLabel(f) },
                         { yAxis: f.hi === Infinity ? 999 : f.hi } ]; }) } };
    s[MARK] = true; return s;
  }

  // build the overlay series from the wind chart's own [t,v] data arrays
  function buildWind(speed, gust) {
    if (!speed || speed.length === 0) return { series: [], byT: {} };
    gust = gust || [];
    var firstT = speed[0][0], lastT = speed[speed.length - 1][0];
    var gustByT = {}, g;
    for (g = 0; g < gust.length; g++) gustByT[gust[g][0]] = gust[g][1];
    var sMed = [], sLo = [], sDelta = [], gMed = [], gLo = [], gDelta = [];
    var byT = {};   // per-timestamp lookup for the hover popover (raw + smoothed)
    for (var i = 0; i < speed.length; i++) {
      var t = speed[i][0];
      byT[t] = { sRaw: speed[i][1], gRaw: gustByT[t] === undefined ? null : gustByT[t],
                 sMed: null, sLo: null, sHi: null, gMed: null };
      if (t < firstT + HALF_MS || t > lastT - HALF_MS) continue;   // centered window not full -> honest gap
      var sw = valsInWindow(speed, t); if (sw.length < 2) continue;
      sw.sort(num);
      var p25 = wsQuantile(sw, 0.25), p50 = wsQuantile(sw, 0.5), p75 = wsQuantile(sw, 0.75);
      sMed.push([t, p50]); sLo.push([t, p25]); sDelta.push([t, p75 - p25]);
      byT[t].sMed = p50; byT[t].sLo = p25; byT[t].sHi = p75;
      var gw = valsInWindow(gust, t);
      if (gw.length) {
        gw.sort(num);
        var gMd = wsQuantile(gw, 0.5), gP90 = wsQuantile(gw, 0.9);
        var lo = Math.min(p75, gP90);
        gMed.push([t, gMd]); gLo.push([t, lo]); gDelta.push([t, Math.max(0, gP90 - lo)]);
        byT[t].gMed = gMd;
      } else { gMed.push([t, null]); gLo.push([t, null]); gDelta.push([t, null]); }
    }
    var series = [];
    series.push(flagCarrier(firstT, lastT));                        // background flag bands (z -2)
    series = series.concat(band("wsc_gceil", gLo, gDelta, GUST, 0.15, -1));   // gust ceiling fill
    series = series.concat(band("wsc_siqr", sLo, sDelta, SPEED, 0.18, 0));    // speed IQR fill
    series.push(spine("gust", gMed, GUST, 2.2, 5));                 // gust median spine
    series.push(spine("speed", sMed, SPEED, 2.4, 6));              // speed median spine
    return { series: series, byT: byT };
  }

  function seriesDataFrom(seriesArr, obs) {
    for (var i = 0; i < seriesArr.length; i++) { var s = seriesArr[i]; if (s.weewxColumn === obs && Array.isArray(s.data)) return s.data; }
    return null;
  }
  // jsonengine's combine_series() interleaves the daily high/low samples into the
  // obs array as 3-element [ts, val, "max"|"min"] points -- duplicating a real
  // sample's timestamp. Drop them: they'd double-draw a dot and double-count in
  // the rolling window. The skin's markPoint uses the separate _daily_high_low
  // key, so the "13.3" max/min labels are unaffected.
  function stripMarkers(seriesArr, obs) {
    for (var i = 0; i < seriesArr.length; i++) {
      var s = seriesArr[i];
      if (s.weewxColumn === obs && Array.isArray(s.data)) {
        s.data = s.data.filter(function (e) { return !(Array.isArray(e) && e.length > 2); });
        return;
      }
    }
  }
  function styleDots(seriesArr, obs) {       // raw dots: faint, slightly larger; keep palette colour + mark points
    for (var i = 0; i < seriesArr.length; i++) {
      var s = seriesArr[i];
      if (s.weewxColumn === obs) { s.symbolSize = 3.4; s.itemStyle = Object.assign({}, s.itemStyle, { opacity: 0.55 }); return; }
    }
  }
  function setYAxis(chartOption) {            // bottom anchored at 0; TOP autoscales
    var y = Array.isArray(chartOption.yAxis) ? chartOption.yAxis[0] : chartOption.yAxis;
    if (!y) { y = {}; chartOption.yAxis = y; }
    y.min = 0; y.scale = false;
    y.splitLine = Object.assign({}, y.splitLine, { lineStyle: Object.assign({}, (y.splitLine || {}).lineStyle, { color: GRID }) });
    y.axisLabel = Object.assign({}, y.axisLabel, { color: AXIS });
  }

  // ---- hover popover (median-led, mirrored rows) -------------------------
  function fmtClock(t) {
    var tz; try { tz = weewxData.config.station_timezone; } catch (e) {}
    try { return new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz || undefined }); }
    catch (e) { return new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
  }
  function tipRow(color, label, val, u) {
    return '<div style="display:flex;align-items:center;margin-top:3px">'
      + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';margin-right:6px"></span>'
      + '<span style="flex:1">' + label + '</span>'
      + '<b style="margin-left:16px">' + val + u + '</b></div>';
  }
  function tipSub(txt) { return '<div style="color:#9aa0ad;font-size:11px;margin:0 0 1px 14px">' + txt + '</div>'; }
  // u = configured speed-unit label with a leading space (e.g. " knots", " mph"); NOT hardcoded.
  function windTooltip(byT, u) {
    return {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: "#c0c4cc" } },
      backgroundColor: "rgba(255,255,255,0.97)", borderColor: "#e0e0e8", borderWidth: 1,
      textStyle: { color: "#333", fontSize: 12 },
      extraCssText: "box-shadow:0 2px 8px rgba(0,0,0,0.15);border-radius:6px;",
      formatter: function (params) {
        if (!params || !params.length) return "";
        var t = params[0].axisValue, d = byT[t];
        if (!d) return "";
        var r = function (x) { return Math.round(x); };
        var sHead = d.sMed != null ? r(d.sMed) : (d.sRaw != null ? r(d.sRaw) : "–");
        var gHead = d.gMed != null ? r(d.gMed) : (d.gRaw != null ? r(d.gRaw) : "–");
        var sSub = "actual " + (d.sRaw != null ? r(d.sRaw) : "–")
          + (d.sLo != null && d.sHi != null ? " · typ " + r(d.sLo) + "–" + r(d.sHi) + u : u);
        var gSub;
        if (d.gMed != null && d.sMed != null)
          gSub = "actual " + (d.gRaw != null ? r(d.gRaw) : "–") + " · gust factor +" + (r(d.gMed) - r(d.sMed)) + u;
        else
          gSub = "actual " + (d.gRaw != null ? r(d.gRaw) : "–") + u;
        return '<div style="min-width:160px;font-variant-numeric:tabular-nums">'
          + '<div style="color:#8a8a8a;font-size:11px;margin-bottom:2px">' + fmtClock(t) + '</div>'
          + tipRow(SPEED, "Sustained Wind", sHead, u) + tipSub(sSub)
          + tipRow(GUST, "Gust", gHead, u) + tipSub(gSub)
          + '</div>';
      }
    };
  }
  // configured display unit for wind speed (the chart series' own label), leading-spaced.
  function speedUnit(seriesArr) {
    for (var i = 0; i < seriesArr.length; i++) {
      var s = seriesArr[i];
      if (s.weewxColumn === SPEED_OBS && s.unit) { var u = String(s.unit).trim(); if (u) return " " + u; }
    }
    return " kt";   // fallback only if the series carries no unit label
  }

  // BUILD-TIME hook: decorate the wind chart's option before setOption.
  function windStatInject(chart, chartOption, chartId) {
    if (chartId !== CHART_ID || !chartOption || !Array.isArray(chartOption.series)) return;
    stripMarkers(chartOption.series, SPEED_OBS);   // drop inline daily-high/low dup markers (dots + stats)
    stripMarkers(chartOption.series, GUST_OBS);
    var speed = seriesDataFrom(chartOption.series, SPEED_OBS);
    if (!speed) return;
    var gust = seriesDataFrom(chartOption.series, GUST_OBS) || [];
    styleDots(chartOption.series, SPEED_OBS);
    styleDots(chartOption.series, GUST_OBS);
    setYAxis(chartOption);
    var built = buildWind(speed, gust);
    for (var i = 0; i < built.series.length; i++) chartOption.series.push(built.series[i]);
    chartOption.tooltip = windTooltip(built.byT, speedUnit(chartOption.series));   // median-led 2-row popover (overrides skin default)
  }

  window.windStatInject = windStatInject;
})();
