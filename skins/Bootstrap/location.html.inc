<div class="row $global_station_info_classes">
    <div class="col-2">
        <i class="bi-globe2 fs-4" title="$gettext('Latitude'), $gettext('Longitude')"></i>
    </div>
    <div class="col-4">
        <div class="text-nowrap">$latest.gpsLatitude.format(format_string="%.6f")</div>
        <div class="text-nowrap">$latest.gpsLongitude.format(format_string="%.6f")</div>
    </div>
    <div class="col-2">
        <i class="bi-arrow-bar-down fs-4" title="$gettext('Altitude')"></i>
    </div>
    <div class="col-4">
        <div class="text-nowrap">$station.altitude</div>
    </div>
</div>