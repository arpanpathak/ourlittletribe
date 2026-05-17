FROM golang:alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /outlittletribe-backend .

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /outlittletribe-backend .
COPY --from=builder /app/db/schema.sql ./db/schema.sql
EXPOSE 8080
CMD ["./outlittletribe-backend"]
