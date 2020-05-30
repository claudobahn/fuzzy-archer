    angular.module('RadarLoopApp', [])
            .controller('LoopController', function ($scope, $interval) {
                var imageIndices = $scope.imageIndices = [
                    '01',
                    '02',
                    '03',
                    '04',
                    '05',
                    '06',
                    '07',
                    '08',
                    '09',
                    '10',
                    '11',
                    '12',
                    '13',
                    '14',
                    '15',
                    '16',
                    '17',
                    '18',
                    '19',
                    '20'
                ];

                var activeIndex = 0;

                var loopInterval = $interval(function () {
                    activeIndex++;
                    if (activeIndex == imageIndices.length) {
                        activeIndex = 0;
                    }
                    $scope.activeIndex = imageIndices[activeIndex];
                }, 250);

                $scope.$on('$destroy', function () {
                    if (angular.isDefined(loopInterval)) {
                        $interval.cancel(loopInterval);
                        loopInterval = undefined;
                    }
                });
            });

