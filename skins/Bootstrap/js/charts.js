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
                interval: category.interval,
                minInterval: category.minInterval,
                maxInterval: category.maxInterval,
                splitNumber: category.splitNumber,
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
        chart.setOption(chartOption);
        chartElement.appendChild(getTimestampDiv(documentChartId, timestamp));
    }
}

function getBooleanOrDefault(value, defaultValue) {
    return value === undefined ? defaultValue : value.toLowerCase() === 'true';
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
