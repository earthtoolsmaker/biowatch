curl -X POST http://localhost:8000/predict \
-H "Content-Type: application/json" \
-d '{
    "instances": [
        {
            "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/camtrap-pictures/image1.jpg"
        },
        {

              "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/camtrap-pictures/image2.jpg"
        },
        {

              "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/camtrap-pictures/image2.jpg"
        },
        {

              "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/camtrap-pictures/image2.jpg"
        },
        {

              "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/camtrap-pictures/image2.jpg"
        },
        {

              "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/camtrap-pictures/image2.jpg"
        },
        {

              "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/camtrap-pictures/image2.jpg"
        },
        {

              "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/camtrap-pictures/image2.jpg"
        },
        {

              "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/camtrap-pictures/image2.jpg"
        }
    ]
}'
